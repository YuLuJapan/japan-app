import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { fixture } from './fixture.js'
import { asOwner as auth, asPartner, useTestTokens } from './auth.js'

const app = createApp()

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  useTestTokens()
})

describe('GET /api/trips/trip-1', () => {
  it('returns the journey skeleton: ordered steps, zone summaries, counts', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1'))
    expect(res.status).toBe(200)
    expect(res.body.trip.name).toBe('Test Trip')
    expect(res.body.steps.map((s: { position: number }) => s.position)).toEqual([1, 2])
    const tokyo = res.body.steps[0].zone
    expect(tokyo.name).toBe('Tokyo')
    // Saved activities only: the counts label Explore's grid, which shows what
    // has not been scheduled yet (FR-011).
    expect(tokyo.saved_counts).toEqual({ hotel: 1, attraction: 0, food: 1, shopping: 0, other: 0 })
    expect(res.body.trip_files_count).toBe(1)
  })

  it("includes both directions of the trip's own flight, for the countdown", async () => {
    const res = await auth(request(app).get('/api/trips/trip-1'))
    const nos = (legs: { flight_no: string }[]) => legs.map((l) => l.flight_no)
    expect(res.body.flight.booking_ref).toBe('TESTREF')

    expect(res.body.flight.outbound.depart_at).toBe('2026-10-01T08:00:00+03:00')
    expect(res.body.flight.outbound.arrive_at).toBe('2026-10-02T06:00:00+09:00')
    expect(nos(res.body.flight.outbound.legs)).toEqual(['TA 1'])

    expect(res.body.flight.return_flight.depart_at).toBe('2026-10-14T10:00:00+09:00')
    expect(res.body.flight.return_flight.arrive_at).toBe('2026-10-14T18:00:00+03:00')
    expect(nos(res.body.flight.return_flight.legs)).toEqual(['TA 2'])
  })

  // The flight used to be a module constant served with whatever trip was
  // being read, so every trip anyone created carried the two travellers' own
  // booking reference. A trip with no booking now has no flight block.
  it('omits the flight entirely for a trip with no booking attached', async () => {
    // trip-2 belongs to the other tenant; its owner is who can read it.
    const res = await asPartner(request(app).get('/api/trips/trip-2'))
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('flight')
  })
})

describe('GET /api/trips/trip-1/zones/:id', () => {
  it('returns zone with tips and files, and no per-category tally', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/zones/zone-tokyo'))
    expect(res.status).toBe(200)
    expect(res.body.zone.name_ja).toBe('東京')
    expect(res.body.tips).toHaveLength(1)
    expect(res.body.tips[0].body).toBe('Get a Suica card')
    // Explore counts dated and undated alike now, off the one `/activities`
    // list it renders. A tally here would be a second number to keep in step.
    expect(res.body.saved_counts).toBeUndefined()
  })

  it('404 for unknown zone', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/zones/zone-nope'))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

// `GET /zones/:id/places` is gone. Both surfaces it backed — a city's category
// list and the city map — now filter the single `GET /activities` list, so the
// endpoint would have returned a subset of a list the caller already holds.
// What it *guaranteed* is still a contract, so it is asserted on that list.
describe('what a city’s lists read out of GET /activities', () => {
  type Row = Record<string, unknown> & { day: string | null }
  const saved = (rows: Row[]) => rows.filter((a) => !a.day)

  it('carries a summary_line, a tag and coordinates on every row', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/activities'))
    expect(res.status).toBe(200)
    const ramen = res.body.activities.find((a: { id: string }) => a.id === 'place-ramen')
    expect(ramen.name).toBe('Ramen Bar')
    expect(ramen.summary_line.length).toBeLessThanOrEqual(100)
    expect(ramen.category).toBe('food')
    // Map fields present even when unset — the map counts what it cannot pin
    // (FR-019), and an absent key and a null are not equally easy to count.
    expect(ramen).toMatchObject({ address: 'Shinjuku', lat: null, lng: null })
  })

  it('holds every category of a city at once, which is what the map plots', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/activities'))
    const inTokyo = saved(res.body.activities).filter((a) => a.zone_id === 'zone-tokyo')
    expect(inTokyo.map((a) => a.name).sort()).toEqual(['Ramen Bar', 'Test Hotel'])
  })

  it('says nothing at all about a city with nothing saved in it', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/activities'))
    const shopsInKyoto = saved(res.body.activities).filter(
      (a) => a.zone_id === 'zone-kyoto' && a.category === 'shopping'
    )
    expect(shopsInKyoto).toEqual([])
  })
})

describe('map coordinates', () => {
  it('round-trips lat/lng through create and shows up in the list', async () => {
    const created = await auth(
      request(app).post('/api/trips/trip-1/activities').send({
        zone_id: 'zone-tokyo',
        category: 'food',
        name: 'Blue Bottle',
        lat: 35.6506849,
        lng: 139.7219251,
      })
    )
    expect(created.status).toBe(201)
    expect(created.body.activity).toMatchObject({ lat: 35.6506849, lng: 139.7219251 })

    const list = await auth(request(app).get('/api/trips/trip-1/activities'))
    const pin = list.body.activities.find((a: { name: string }) => a.name === 'Blue Bottle')
    expect(pin).toMatchObject({ lat: 35.6506849, lng: 139.7219251, category: 'food' })
  })

  it('lets a **scheduled** activity carry a pin, which is the point of 010', async () => {
    const created = await auth(
      request(app).post('/api/trips/trip-1/activities').send({
        zone_id: 'zone-tokyo',
        day: '2026-10-06',
        name: 'Coffee before the train',
        lat: 35.68,
        lng: 139.76,
      })
    )
    expect(created.status).toBe(201)
    expect(created.body.activity).toMatchObject({ day: '2026-10-06', lat: 35.68, lng: 139.76 })
  })

  it('attaches coords to an existing activity via PATCH (the "pin it" action)', async () => {
    const res = await auth(
      request(app)
        .patch('/api/trips/trip-1/activities/place-hotel')
        .send({ lat: 35.69, lng: 139.7 })
    )
    expect(res.status).toBe(200)
    expect(res.body.activity).toMatchObject({ lat: 35.69, lng: 139.7 })
  })

  it('400 VALIDATION for out-of-range coordinates', async () => {
    const res = await auth(
      request(app).post('/api/trips/trip-1/activities').send({
        zone_id: 'zone-tokyo',
        category: 'food',
        name: 'Bad Coords',
        lat: 999,
        lng: 0,
      })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })
})

describe('GET /api/trips/trip-1/activities/:id', () => {
  it('returns full detail with tips and files', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/activities/place-ramen'))
    expect(res.status).toBe(200)
    expect(res.body.activity.links[0].url).toBe('https://example.com')
    expect(res.body.tips[0].body).toBe('Cash only')
    expect(res.body.files[0].display_name).toBe('Menu photo')
  })

  it('404 for an unknown activity', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/activities/place-nope'))
    expect(res.status).toBe(404)
  })
})
