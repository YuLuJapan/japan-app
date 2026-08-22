// The guest code: sees the trip, cannot change it, and never gets a document.
// The frontend hides the buttons; these are the checks that actually hold.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { TEST_CODE, fixture } from './fixture.js'

const GUEST_CODE = 'test-guest-code'

process.env.TRIP_ACCESS_CODE = TEST_CODE
process.env.TRIP_GUEST_CODE = GUEST_CODE
const app = createApp()

const asOwner = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_CODE}`)
const asGuest = (r: request.Test) => r.set('Authorization', `Bearer ${GUEST_CODE}`)

beforeEach(() => setDataStore(createMemoryStore(fixture())))

describe('guest access code', () => {
  it('signs in and is told it is a guest', async () => {
    const res = await request(app).post('/api/auth/verify').send({ code: GUEST_CODE })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, role: 'guest' })
  })

  it('reports the role of the code in use', async () => {
    expect((await asGuest(request(app).get('/api/auth/session'))).body).toEqual({ role: 'guest' })
    expect((await asOwner(request(app).get('/api/auth/session'))).body).toEqual({ role: 'owner' })
  })

  it('reads the trip, the zones, the places and the schedule', async () => {
    for (const path of [
      '/api/trips/trip-1',
      '/api/trips/trip-1/itinerary',
      '/api/trips/trip-1/zones/zone-tokyo',
      '/api/trips/trip-1/zones/zone-tokyo/places?category=food',
      '/api/trips/trip-1/places/place-ramen',
      '/api/trips/trip-1/shopping',
      '/api/trips/trip-1/reminders',
      '/api/trips/trip-1/search?q=ramen',
    ]) {
      const res = await asGuest(request(app).get(path))
      expect(res.status, path).toBe(200)
    }
  })
})

describe('guest is read-only', () => {
  const writes: [string, string, object][] = [
    ['post', '/api/trips/trip-1/places', { zone_id: 'zone-tokyo', category: 'food', name: 'New' }],
    ['patch', '/api/trips/trip-1/places/place-ramen', { name: 'Renamed' }],
    ['delete', '/api/trips/trip-1/places/place-ramen', {}],
    ['post', '/api/trips/trip-1/tips', { body: 'hello', zone_id: 'zone-tokyo' }],
    ['patch', '/api/trips/trip-1/tips/tip-zone', { body: 'edited' }],
    ['delete', '/api/trips/trip-1/tips/tip-zone', {}],
    ['post', '/api/trips/trip-1/shopping', { name: 'Thing', category: 'other' }],
    ['patch', '/api/trips/trip-1/shopping/buy-1', { bought: true }],
    ['delete', '/api/trips/trip-1/shopping/buy-1', {}],
    ['post', '/api/trips/trip-1/itinerary', { day: '2026-10-06', title: 'Something' }],
    ['patch', '/api/trips/trip-1/itinerary/itin-ramen', { title: 'Edited' }],
    ['delete', '/api/trips/trip-1/itinerary/itin-ramen', {}],
    [
      'post',
      '/api/trips/trip-1/steps',
      { zone_id: 'zone-tokyo', start_date: '2026-10-06', end_date: '2026-10-07' },
    ],
    ['patch', '/api/trips/trip-1/steps/step-1', { start_date: '2026-10-06' }],
    ['delete', '/api/trips/trip-1/steps/step-1', {}],
    [
      'post',
      '/api/trips/trip-1/reminders',
      { title: 'Book it', remind_at: '2026-09-01T10:00:00.000Z' },
    ],
    ['post', '/api/push/subscriptions', { endpoint: 'https://example.com/x', keys: {} }],
  ]

  it.each(writes)('refuses %s %s', async (method, path, body) => {
    const call = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](
      path
    )
    const res = await asGuest(call).send(body)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('leaves the data untouched after a refused delete', async () => {
    await asGuest(request(app).delete('/api/trips/trip-1/places/place-ramen'))
    const res = await asOwner(request(app).get('/api/trips/trip-1/places/place-ramen'))
    expect(res.status).toBe(200)
    expect(res.body.place.name).toBe('Ramen Bar')
  })
})

describe('guest sees no documents', () => {
  it('refuses every /api/files route', async () => {
    const paths = [
      '/api/trips/trip-1/files',
      '/api/trips/trip-1/files/file-trip/url',
      '/api/trips/trip-1/files/file-trip/content',
    ]
    for (const path of paths) {
      const res = await asGuest(request(app).get(path))
      expect(res.status, path).toBe(403)
      expect(res.body.error.code, path).toBe('FORBIDDEN')
    }
    const del = await asGuest(request(app).delete('/api/trips/trip-1/files/file-trip'))
    expect(del.status).toBe(403)
  })

  it('strips files attached to a place', async () => {
    const owner = await asOwner(request(app).get('/api/trips/trip-1/places/place-ramen'))
    expect(owner.body.files.length).toBeGreaterThan(0) // the fixture has one

    const guest = await asGuest(request(app).get('/api/trips/trip-1/places/place-ramen'))
    expect(guest.status).toBe(200)
    expect(guest.body.files).toEqual([])
    expect(guest.body.place.name).toBe('Ramen Bar') // everything else is still there
    expect(guest.body.tips.length).toBeGreaterThan(0)
  })

  it('strips files attached to a zone', async () => {
    const owner = await asOwner(request(app).get('/api/trips/trip-1/zones/zone-kyoto'))
    expect(owner.body.files.length).toBeGreaterThan(0)

    const guest = await asGuest(request(app).get('/api/trips/trip-1/zones/zone-kyoto'))
    expect(guest.status).toBe(200)
    expect(guest.body.files).toEqual([])
    expect(guest.body.zone.name).toBe('Kyoto')
  })
})

// A stay carries the booking itself (price, confirmation, cancellation terms,
// the Booking.com link) in its description, and the flight carries the booking
// reference — neither belongs in a friend's copy of the trip.
describe('guest sees no stays and no flight', () => {
  it('refuses the stay page outright', async () => {
    const res = await asGuest(request(app).get('/api/trips/trip-1/places/place-hotel'))
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('leaves stays out of a zone’s lists and counts', async () => {
    const zone = await asGuest(request(app).get('/api/trips/trip-1/zones/zone-tokyo'))
    expect(zone.status).toBe(200)
    expect(zone.body.place_counts.hotel).toBe(0)
    expect(zone.body.place_counts.food).toBe(1) // the rest is untouched

    const stays = await asGuest(
      request(app).get('/api/trips/trip-1/zones/zone-tokyo/places?category=hotel')
    )
    expect(stays.body.places).toEqual([])

    // the map's all-categories sweep is the other way in
    const all = await asGuest(
      request(app).get('/api/trips/trip-1/zones/zone-tokyo/places?category=')
    )
    expect(all.body.places.map((p: { id: string }) => p.id)).toEqual(['place-ramen'])
  })

  it('drops the flight and the stay counts from the trip bundle', async () => {
    for (const path of ['/api/trips/trip-1', '/api/trips/trip-1']) {
      const res = await asGuest(request(app).get(path))
      expect(res.status, path).toBe(200)
      expect(res.body.flight, path).toBeUndefined()
      expect(res.body.trip.name, path).toBe('Test Trip') // still the same trip
      for (const step of res.body.steps) {
        expect(step.zone.place_counts.hotel, path).toBe(0)
      }
    }
  })

  it('keeps stays and their tips out of search', async () => {
    setDataStore(
      createMemoryStore({
        ...fixture(),
        tips: [
          { id: 'tip-hotel', zone_id: null, place_id: 'place-hotel', body: 'Test Hotel bath' },
        ],
      })
    )

    const owner = await asOwner(request(app).get('/api/trips/trip-1/search?q=Test Hotel'))
    expect(owner.body.results.length).toBeGreaterThan(0)

    const guest = await asGuest(request(app).get('/api/trips/trip-1/search?q=Test Hotel'))
    expect(guest.status).toBe(200)
    // neither the stay itself nor a tip whose only link is to the stay
    expect(guest.body.results).toEqual([])
  })

  it('cuts the stay link off a day-plan item but keeps the plan', async () => {
    const base = fixture()
    const items = base.itinerary ?? []
    setDataStore(
      createMemoryStore({
        ...base,
        itinerary: [
          { ...items[0], id: 'itin-checkin', place_id: 'place-hotel', title: 'Check in' },
          ...items,
        ],
      })
    )

    const res = await asGuest(request(app).get('/api/trips/trip-1/itinerary'))
    expect(res.status).toBe(200)
    const checkIn = res.body.items.find((i: { id: string }) => i.id === 'itin-checkin')
    expect(checkIn.title).toBe('Check in') // the day still reads the same
    expect(checkIn.place_id).toBeNull() // but leads nowhere it would be refused
    // an item pointing at an ordinary place still links
    const ramen = res.body.items.find((i: { id: string }) => i.id === 'itin-ramen')
    expect(ramen.place_id).toBe('place-ramen')
  })
})

describe('the owner code is unaffected', () => {
  it('still sees the stays and the flight', async () => {
    const stay = await asOwner(request(app).get('/api/trips/trip-1/places/place-hotel'))
    expect(stay.status).toBe(200)
    expect(stay.body.place.name).toBe('Test Hotel')

    const zone = await asOwner(request(app).get('/api/trips/trip-1/zones/zone-tokyo'))
    expect(zone.body.place_counts.hotel).toBe(1)

    const trip = await asOwner(request(app).get('/api/trips/trip-1'))
    expect(trip.body.flight.booking_ref).toBeTruthy()
  })

  it('still writes and still sees documents', async () => {
    const patch = await asOwner(request(app).patch('/api/trips/trip-1/places/place-ramen')).send({
      name: 'Ramen Bar 2',
    })
    expect(patch.status).toBe(200)

    const files = await asOwner(request(app).get('/api/trips/trip-1/files'))
    expect(files.status).toBe(200)
    expect(files.body.files.length).toBeGreaterThan(0)
  })
})
