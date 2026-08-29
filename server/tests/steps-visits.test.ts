// A city visited twice is two separate cities (spec 011).
//
// The bug this closes: a trip returning to Tokyo showed two stops on the
// journey and one Tokyo page, pooling both stays' places, tips and counts —
// the last night's restaurant next to the first morning's coffee.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { fixture, fixtureWithRepeatedCity } from './fixture.js'
import { asOwner as auth, useTestTokens } from './auth.js'

const app = createApp()
let store: DataStore

const load = (data = fixtureWithRepeatedCity()) => {
  store = createMemoryStore(data)
  setDataStore(store)
}

beforeEach(() => {
  load()
  useTestTokens()
})

describe('a city visited once is untouched (FR-003)', () => {
  beforeEach(() => load(fixture()))

  it('reports one visit and no siblings, so no screen offers anything new', () => {
    // The control case, and the one most likely to regress silently: every
    // trip but the ones this feature exists for.
    return auth(request(app).get('/api/trips/trip-1/zones/zone-kyoto')).then((res) => {
      expect(res.status).toBe(200)
      expect(res.body.visit).toMatchObject({ ordinal: 1, total: 1, siblings: [] })
    })
  })

  it('still carries the stop dates, so the page can date itself as it always did', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/zones/zone-tokyo'))
    expect(res.body.visit).toMatchObject({
      step_id: 'step-1',
      start_date: '2026-10-05',
      end_date: '2026-10-09',
    })
  })
})

describe('two visits to one city', () => {
  it('numbers them by date and points each at the other', async () => {
    const first = await auth(request(app).get('/api/trips/trip-1/zones/zone-tokyo'))
    const second = await auth(request(app).get('/api/trips/trip-1/zones/zone-tokyo-2'))

    expect(first.body.visit).toMatchObject({ ordinal: 1, total: 2 })
    expect(second.body.visit).toMatchObject({ ordinal: 2, total: 2 })
    expect(first.body.visit.siblings.map((s: { zone_id: string }) => s.zone_id)).toEqual([
      'zone-tokyo-2',
    ])
    expect(second.body.visit.siblings.map((s: { zone_id: string }) => s.zone_id)).toEqual([
      'zone-tokyo',
    ])
  })

  it('keeps their places, tips and counts entirely apart (FR-001, FR-002)', async () => {
    const first = await auth(request(app).get('/api/trips/trip-1/zones/zone-tokyo'))
    const second = await auth(request(app).get('/api/trips/trip-1/zones/zone-tokyo-2'))

    // The first stay keeps everything it collected; the second starts empty.
    expect(first.body.place_counts.food).toBe(1)
    expect(first.body.place_counts.hotel).toBe(1)
    expect(first.body.tips.length).toBeGreaterThan(0)

    expect(second.body.place_counts).toEqual({
      hotel: 0,
      attraction: 0,
      food: 0,
      shopping: 0,
      other: 0,
    })
    expect(second.body.tips).toEqual([])

    const secondPlaces = await auth(
      request(app).get('/api/trips/trip-1/zones/zone-tokyo-2/places?category=')
    )
    expect(secondPlaces.body.places).toEqual([])
  })

  it('counts what its own list holds, on both stays (SC-001)', async () => {
    for (const zoneId of ['zone-tokyo', 'zone-tokyo-2']) {
      const detail = await auth(request(app).get(`/api/trips/trip-1/zones/${zoneId}`))
      const list = await auth(
        request(app).get(`/api/trips/trip-1/zones/${zoneId}/places?category=`)
      )
      const counted = Object.values(detail.body.place_counts as Record<string, number>).reduce(
        (a, b) => a + b,
        0
      )
      expect(counted).toBe(list.body.places.length)
    }
  })
})

describe('new content lands on the visit you are looking at (FR-008)', () => {
  it('files a place against the stay it was added from, and nowhere else', async () => {
    const created = await auth(
      request(app)
        .post('/api/trips/trip-1/places')
        .send({ zone_id: 'zone-tokyo-2', category: 'food', name: 'Last-night ramen' })
    )
    expect(created.status).toBe(201)

    const second = await auth(
      request(app).get('/api/trips/trip-1/zones/zone-tokyo-2/places?category=food')
    )
    expect(second.body.places.map((p: { name: string }) => p.name)).toContain('Last-night ramen')

    const first = await auth(
      request(app).get('/api/trips/trip-1/zones/zone-tokyo/places?category=food')
    )
    expect(first.body.places.map((p: { name: string }) => p.name)).not.toContain('Last-night ramen')
  })

  it('files a tip against that stay too', async () => {
    await auth(
      request(app)
        .post('/api/trips/trip-1/tips')
        .send({ zone_id: 'zone-tokyo-2', body: 'Leave the bags at the station' })
    )
    const second = await auth(request(app).get('/api/trips/trip-1/zones/zone-tokyo-2'))
    const first = await auth(request(app).get('/api/trips/trip-1/zones/zone-tokyo'))
    expect(second.body.tips.map((t: { body: string }) => t.body)).toContain(
      'Leave the bags at the station'
    )
    expect(first.body.tips.map((t: { body: string }) => t.body)).not.toContain(
      'Leave the bags at the station'
    )
  })
})

describe('a visit taken off the journey (FR-011, R8)', () => {
  it('keeps its content and still opens, with no dates left to show', async () => {
    // Deleting a stop must not delete what it holds — the app's existing rule
    // is that content survives a delete (a place's files are reparented rather
    // than lost), and a date change is a far weaker reason to drop anything.
    const deleted = await auth(request(app).delete('/api/trips/trip-1/steps/step-3'))
    expect(deleted.status).toBe(204)

    const res = await auth(request(app).get('/api/trips/trip-1/zones/zone-tokyo-2'))
    expect(res.status).toBe(200)
    expect(res.body.visit).toMatchObject({ step_id: null, start_date: null, end_date: null })
    // Still a sibling of the first stay: it is off the journey, not gone.
    expect(res.body.visit.total).toBe(2)
  })
})
