// GET /api/trips/:tripId/export — the endpoint, end to end.
//
// The projection itself is table-tested in export-view.test.ts. What is
// asserted here is everything the route adds: validation, who may call it,
// what a 404 looks like, and — the two that matter most — that the strings a
// share export exists to keep out are nowhere in the serialised response, and
// that a full export by an *owner* still carries no flight, no shopping item,
// no document and no member name (FR-004a).
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { VIEWER_USER, fixture, largeFixture } from './fixture.js'
import { asOutsider, asOwner, asViewer, useTestTokens } from './auth.js'

const app = createApp()

let store: DataStore

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
})

/** Puts the friend on trip-1 read-only, with stays hidden by default. */
const addViewer = (stays = false) =>
  store.upsertTripMember({
    trip_id: 'trip-1',
    user_id: VIEWER_USER.id,
    role: 'viewer',
    can_see_stays: stays,
    can_see_flight: false,
    can_see_documents: false,
    can_see_shopping: false,
  })

const get = (detail: string) =>
  asOwner(request(app).get(`/api/trips/trip-1/export?detail=${detail}`))

describe('GET /export', () => {
  it('answers at share detail with the journey, its zones and its dates', async () => {
    const res = await get('share')
    expect(res.status).toBe(200)
    const payload = res.body.export
    expect(payload.detail).toBe('share')
    expect(payload.generated_at).toEqual(expect.any(String))
    expect(payload.trip).toMatchObject({ start_date: '2026-10-01', end_date: '2026-10-14' })
    expect(payload.steps.map((s: { zone: { name: string } }) => s.zone.name)).toEqual([
      'Tokyo',
      'Kyoto',
    ])
    expect(payload.stats).toEqual({
      place_count: 4,
      places_without_address: 1,
      day_count: 0,
      included_stays: true,
    })
  })

  it('400s on a missing detail, and on one that is neither version', async () => {
    for (const url of [
      '/api/trips/trip-1/export',
      '/api/trips/trip-1/export?detail=',
      '/api/trips/trip-1/export?detail=everything',
      '/api/trips/trip-1/export?detail=SHARE',
    ]) {
      const res = await asOwner(request(app).get(url))
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION')
      expect(res.body.error.details).toEqual(['detail must be "share" or "full"'])
    }
  })

  it('404s for a trip the caller is not a member of — never 403', async () => {
    const res = await asOutsider(request(app).get('/api/trips/trip-1/export?detail=share'))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('401s without a token', async () => {
    expect((await request(app).get('/api/trips/trip-1/export?detail=share')).status).toBe(401)
  })

  it('lets a viewer export — the file is a subset of what they already see', async () => {
    await addViewer(true)
    const res = await asViewer(request(app).get('/api/trips/trip-1/export?detail=full'))
    expect(res.status).toBe(200)
    expect(res.body.export.stats.included_stays).toBe(true)
  })
})

describe('the share version', () => {
  it('carries nothing the traveller typed about a place', async () => {
    // The fixture's ryokan description contains all three words, and its
    // links carry the confirmation code. Grepping the whole serialised body is
    // the point: this is not a check that the keys we thought of are absent.
    const body = JSON.stringify((await get('share')).body)
    for (const secret of ['booking', 'confirmation', 'reservation', 'RYO-99231']) {
      expect(body.toLowerCase()).not.toContain(secret.toLowerCase())
    }
    expect(body).not.toContain('Cash only') // a tip
    expect(body).not.toContain('Big city') // a zone summary
    expect(body).not.toContain('Walk Shinjuku') // the day plan
  })

  it('still lists every category, stays included', async () => {
    const names = (await get('share')).body.export.steps.flatMap(
      (s: { zone: { places: { name: string }[] } }) => s.zone.places.map((p) => p.name)
    )
    expect(names).toEqual(
      expect.arrayContaining(['Ramen Bar', 'Test Hotel', 'Fushimi Inari', 'Kyoto Ryokan'])
    )
  })
})

describe('the full version', () => {
  it('carries descriptions, links, tips and the day plan', async () => {
    const payload = (await get('full')).body.export
    const inari = payload.steps
      .flatMap((s: { zone: { places: { name: string }[] } }) => s.zone.places)
      .find((p: { name: string }) => p.name === 'Fushimi Inari')
    expect(inari.description).toContain('Go before 7am')
    expect(inari.links).toHaveLength(2)
    expect(payload.steps[0].zone.tips).toEqual(['Get a Suica card'])
    // The whole trip, day by day, each day saying where it is spent.
    expect(payload.days).toHaveLength(14)
    expect(payload.days.find((d: { day: string }) => d.day === '2026-10-09').zones).toEqual([
      'Tokyo',
      'Kyoto',
    ])
    // `day_count` still counts the days carrying something, not the days listed.
    expect(payload.stats.day_count).toBe(2)
  })

  it('carries no flight, no shopping item, no document and no member name — for an owner too', async () => {
    // FR-004a, and the case most likely to be assumed safe: this caller has
    // the unrestricted view, so nothing filtered any of it out. It is not in
    // the projection at all.
    const body = JSON.stringify((await get('full')).body)
    for (const secret of [
      'TESTREF', // the flight's booking reference
      'Test Air',
      'Narita',
      'Onitsuka', // a shopping item — the presents
      'Ichikami',
      'Flight booking', // a document
      'Menu photo',
      'Alex', // a traveller on the roster
      'yuval@example.com', // a member
    ]) {
      expect(body).not.toContain(secret)
    }
  })
})

describe('a viewer who may not see stays', () => {
  it('receives no hotel, no tip belonging to one, and included_stays: false', async () => {
    await addViewer(false)
    const res = await asViewer(request(app).get('/api/trips/trip-1/export?detail=full'))
    expect(res.status).toBe(200)
    const payload = res.body.export

    const names = payload.steps.flatMap((s: { zone: { places: { name: string }[] } }) =>
      s.zone.places.map((p) => p.name)
    )
    expect(names).not.toContain('Kyoto Ryokan')
    expect(names).not.toContain('Test Hotel')
    expect(names).toContain('Fushimi Inari')

    const body = JSON.stringify(res.body)
    expect(body).not.toContain('Check in after 15:00') // the tip on the stay
    expect(body).not.toContain('RYO-99231')

    expect(payload.stats.included_stays).toBe(false)
    // The stays are out of the count as well, and nothing says so in words.
    expect(payload.stats.place_count).toBe(2)
    expect(body).not.toMatch(/withheld|hidden from you/i)
  })

  it('keeps the day-plan row that pointed at the stay, without its link', async () => {
    await addViewer(false)
    const res = await asViewer(request(app).get('/api/trips/trip-1/export?detail=full'))
    const row = res.body.export.days
      .flatMap((d: { items: { title: string; place_name?: string }[] }) => d.items)
      .find((i: { title: string }) => i.title === 'Check into the ryokan')
    expect(row).toBeDefined()
    expect(row.place_name).toBeUndefined()
  })
})

describe('determinism', () => {
  it('returns the same content for the same trip at the same detail', async () => {
    const strip = (body: { export: Record<string, unknown> }) => {
      const rest = { ...body.export }
      // The one field that is allowed to differ between two exports.
      delete rest.generated_at
      return JSON.stringify(rest)
    }
    expect(strip((await get('full')).body)).toBe(strip((await get('full')).body))
  })
})

describe('a trip three times the real size', () => {
  beforeEach(() => {
    store = createMemoryStore(largeFixture())
    setDataStore(store)
  })

  it('is assembled in four store reads, not sixty', async () => {
    // The claim research R5 rests on, and the one that cannot be checked by
    // reading the response: with the per-parent reads this would be one query
    // per zone plus one per place — well over a hundred here — inside a single
    // serverless invocation, passing instantly against this very store.
    const reads: string[] = []
    setDataStore(
      new Proxy(store, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          if (typeof value !== 'function' || typeof prop !== 'string') return value
          return (...args: unknown[]) => {
            reads.push(prop)
            return (value as (...a: unknown[]) => unknown).apply(target, args)
          }
        },
      })
    )

    const res = await get('full')
    expect(res.status).toBe(200)
    // getTrip, getTripMember and listMembershipsForUser belong to the door
    // (lib/auth.ts, lib/trip-context.ts), not to the export.
    const access = new Set(['listMembershipsForUser'])
    const gathering = reads.filter((r) => r.startsWith('list') && !access.has(r))
    expect(gathering.sort()).toEqual(['listActivities', 'listAllTips', 'listSteps', 'listZones'])
  })

  it('carries every stop and every place, and counts the missing addresses', async () => {
    const payload = (await get('share')).body.export
    // 12 generated stops plus the two the small fixture already had.
    expect(payload.steps).toHaveLength(14)
    // 120 generated places plus the small fixture's four.
    expect(payload.stats.place_count).toBe(124)
    // Every fifth generated place has none, plus "Test Hotel".
    expect(payload.stats.places_without_address).toBe(25)

    const names = payload.steps.flatMap((s: { zone: { places: { name: string }[] } }) =>
      s.zone.places.map((p) => p.name)
    )
    expect(names).toHaveLength(124)
    expect(names).toContain('Place 12-10')
  })
})
