import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { TEST_CODE, fixture } from './fixture.js'

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_CODE}`)

beforeEach(() => setDataStore(createMemoryStore(fixture())))

describe('GET /api/trip', () => {
  it('returns the journey skeleton: ordered steps, zone summaries, counts', async () => {
    const res = await auth(request(app).get('/api/trip'))
    expect(res.status).toBe(200)
    expect(res.body.trip.name).toBe('Test Trip')
    expect(res.body.steps.map((s: { position: number }) => s.position)).toEqual([1, 2])
    const tokyo = res.body.steps[0].zone
    expect(tokyo.name).toBe('Tokyo')
    expect(tokyo.place_counts).toEqual({ hotel: 1, attraction: 0, food: 1, shopping: 0, other: 0 })
    expect(res.body.trip_files_count).toBe(1)
  })

  it('includes the outbound flight (booking ref + legs) for the countdown', async () => {
    const res = await auth(request(app).get('/api/trip'))
    expect(res.body.flight.booking_ref).toBe('AOXIUF')
    expect(res.body.flight.depart_at).toBe('2026-09-18T16:15:00+03:00')
    expect(res.body.flight.legs.map((l: { flight_no: string }) => l.flight_no)).toEqual([
      'ET 419',
      'ET 672',
    ])
  })
})

describe('GET /api/zones/:id', () => {
  it('returns zone with tips, files and counts', async () => {
    const res = await auth(request(app).get('/api/zones/zone-tokyo'))
    expect(res.status).toBe(200)
    expect(res.body.zone.name_ja).toBe('東京')
    expect(res.body.tips).toHaveLength(1)
    expect(res.body.tips[0].body).toBe('Get a Suica card')
    expect(res.body.place_counts.food).toBe(1)
  })

  it('404 for unknown zone', async () => {
    const res = await auth(request(app).get('/api/zones/zone-nope'))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

describe('GET /api/zones/:id/places', () => {
  it('lists places of a category with summary_line', async () => {
    const res = await auth(request(app).get('/api/zones/zone-tokyo/places?category=food'))
    expect(res.status).toBe(200)
    expect(res.body.places).toHaveLength(1)
    expect(res.body.places[0].name).toBe('Ramen Bar')
    expect(res.body.places[0].summary_line.length).toBeLessThanOrEqual(100)
  })

  it('returns empty list for a category with no places', async () => {
    const res = await auth(request(app).get('/api/zones/zone-kyoto/places?category=shopping'))
    expect(res.status).toBe(200)
    expect(res.body.places).toEqual([])
  })

  it('400 VALIDATION for a bad category', async () => {
    const res = await auth(request(app).get('/api/zones/zone-tokyo/places?category=nightlife'))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('lists every category (with coords) when no category is given — the map view', async () => {
    const res = await auth(request(app).get('/api/zones/zone-tokyo/places'))
    expect(res.status).toBe(200)
    // both the food place and the hotel, across categories
    expect(res.body.places.map((p: { name: string }) => p.name).sort()).toEqual([
      'Ramen Bar',
      'Test Hotel',
    ])
    // map fields are exposed even when unset
    const ramen = res.body.places.find((p: { name: string }) => p.name === 'Ramen Bar')
    expect(ramen).toMatchObject({ address: 'Shinjuku', lat: null, lng: null })
  })
})

describe('place map coordinates', () => {
  it('round-trips lat/lng through create and shows up in the map listing', async () => {
    const created = await auth(
      request(app).post('/api/places').send({
        zone_id: 'zone-tokyo',
        category: 'food',
        name: 'Blue Bottle',
        lat: 35.6506849,
        lng: 139.7219251,
      })
    )
    expect(created.status).toBe(201)
    expect(created.body.place).toMatchObject({ lat: 35.6506849, lng: 139.7219251 })

    const list = await auth(request(app).get('/api/zones/zone-tokyo/places'))
    const pin = list.body.places.find((p: { name: string }) => p.name === 'Blue Bottle')
    expect(pin).toMatchObject({ lat: 35.6506849, lng: 139.7219251, category: 'food' })
  })

  it('attaches coords to an existing place via PATCH (the "pin it" action)', async () => {
    const res = await auth(
      request(app).patch('/api/places/place-hotel').send({ lat: 35.69, lng: 139.7 })
    )
    expect(res.status).toBe(200)
    expect(res.body.place).toMatchObject({ lat: 35.69, lng: 139.7 })
  })

  it('400 VALIDATION for out-of-range coordinates', async () => {
    const res = await auth(
      request(app).post('/api/places').send({
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

describe('GET /api/places/:id', () => {
  it('returns full place detail with tips and files', async () => {
    const res = await auth(request(app).get('/api/places/place-ramen'))
    expect(res.status).toBe(200)
    expect(res.body.place.links[0].url).toBe('https://example.com')
    expect(res.body.tips[0].body).toBe('Cash only')
    expect(res.body.files[0].display_name).toBe('Menu photo')
  })

  it('404 for unknown place', async () => {
    const res = await auth(request(app).get('/api/places/place-nope'))
    expect(res.status).toBe(404)
  })
})
