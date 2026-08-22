import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { fixture } from './fixture.js'
import { asOwner as auth, useTestTokens } from './auth.js'

const app = createApp()

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  useTestTokens()
})

describe('itinerary', () => {
  it('GET /api/itinerary returns the trip items sorted (timed before untimed)', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/itinerary'))
    expect(res.status).toBe(200)
    const ids = res.body.items.map((i: { id: string }) => i.id)
    expect(ids).toEqual(['itin-ramen', 'itin-walk']) // 20:00 before "anytime"
  })

  it('POST /api/itinerary creates an item and it appears in the list', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/itinerary')).send({
      zone_id: 'zone-kyoto',
      day: '2026-10-10',
      start_time: '09:30',
      title: 'Fushimi Inari',
    })
    expect(res.status).toBe(201)
    expect(res.body.item.id).toBeTruthy()
    expect(res.body.item.trip_id).toBe('trip-1') // trip id is derived, not client-supplied

    const list = await auth(request(app).get('/api/trips/trip-1/itinerary'))
    expect(list.body.items.map((i: { title: string }) => i.title)).toContain('Fushimi Inari')
  })

  it('POST 400 on missing title, bad day, and bad time', async () => {
    const bad = await auth(request(app).post('/api/trips/trip-1/itinerary')).send({
      title: '  ',
      day: '10/10/2026',
      start_time: '25:00',
    })
    expect(bad.status).toBe(400)
    const details = bad.body.error.details.join(' ')
    expect(details).toMatch(/title is required/)
    expect(details).toMatch(/day must be an ISO date/)
    expect(details).toMatch(/start_time must be HH:MM/)
  })

  it("POST 400 when the day falls outside the trip's own dates", async () => {
    // fixture trip-1 runs 2026-10-01 → 2026-10-14
    for (const day of ['2026-09-30', '2026-10-15']) {
      const res = await auth(request(app).post('/api/trips/trip-1/itinerary')).send({
        day,
        title: 'Too early',
      })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION')
      expect(res.body.error.details.join(' ')).toMatch(/day must fall within the trip's dates/)
    }
  })

  it("POST accepts the trip's first and last day", async () => {
    for (const day of ['2026-10-01', '2026-10-14']) {
      const res = await auth(request(app).post('/api/trips/trip-1/itinerary')).send({
        day,
        title: 'Edge day',
      })
      expect(res.status).toBe(201)
    }
  })

  it('POST /api/trips/:tripId/itinerary validates against that trip, not the default one', async () => {
    const created = await auth(request(app).post('/api/trips')).send({
      name: 'Lisbon',
      start_date: '2027-03-01',
      end_date: '2027-03-08',
    })
    const tripId = created.body.trip.id

    const inRange = await auth(request(app).post(`/api/trips/${tripId}/itinerary`)).send({
      day: '2027-03-04',
      title: 'Pastéis de Belém',
    })
    expect(inRange.status).toBe(201)

    const outOfRange = await auth(request(app).post(`/api/trips/${tripId}/itinerary`)).send({
      day: '2026-10-06', // inside the *other* trip's dates
      title: 'Wrong trip',
    })
    expect(outOfRange.status).toBe(400)
    expect(outOfRange.body.error.code).toBe('VALIDATION')
  })

  it("PATCH 400 when the new day falls outside the trip's dates; 404 for an unknown item", async () => {
    const res = await auth(request(app).patch('/api/trips/trip-1/itinerary/itin-ramen')).send({
      day: '2026-10-20',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')

    const moved = await auth(request(app).patch('/api/trips/trip-1/itinerary/itin-ramen')).send({
      day: '2026-10-07',
    })
    expect(moved.status).toBe(200)
    expect(moved.body.item.day).toBe('2026-10-07')

    const gone = await auth(request(app).patch('/api/trips/trip-1/itinerary/itin-nope')).send({
      day: '2026-10-07',
    })
    expect(gone.status).toBe(404)
  })

  it('POST 404 for an unknown zone', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/itinerary')).send({
      zone_id: 'zone-nope',
      day: '2026-10-10',
      title: 'Ghost stop',
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/trips/trip-1/itinerary/:id updates fields; clearing the time is allowed', async () => {
    const res = await auth(request(app).patch('/api/trips/trip-1/itinerary/itin-ramen')).send({
      title: 'Late-night ramen',
      start_time: '',
    })
    expect(res.status).toBe(200)
    expect(res.body.item.title).toBe('Late-night ramen')
    expect(res.body.item.start_time).toBeNull()
  })

  it('DELETE /api/trips/trip-1/itinerary/:id removes it; 404 when unknown', async () => {
    expect((await auth(request(app).delete('/api/trips/trip-1/itinerary/itin-walk'))).status).toBe(
      204
    )
    expect((await auth(request(app).delete('/api/trips/trip-1/itinerary/itin-walk'))).status).toBe(
      404
    )
  })

  it('deleting a place keeps its day plan but unlinks it (place_id → null)', async () => {
    const del = await auth(request(app).delete('/api/trips/trip-1/places/place-ramen'))
    expect(del.status).toBe(204)

    const list = await auth(request(app).get('/api/trips/trip-1/itinerary'))
    const item = list.body.items.find((i: { id: string }) => i.id === 'itin-ramen')
    expect(item).toBeTruthy() // still there
    expect(item.place_id).toBeNull() // but no longer linked
  })
})

describe('trip-scoped itinerary routes', () => {
  it('GET/POST /api/trips/:tripId/itinerary are isolated from the legacy default trip', async () => {
    const trip2 = await auth(request(app).post('/api/trips')).send({
      name: 'Dolomites',
      start_date: '2027-02-06',
      end_date: '2027-02-14',
    })
    const tripId = trip2.body.trip.id

    const created = await auth(request(app).post(`/api/trips/${tripId}/itinerary`)).send({
      day: '2027-02-07',
      title: 'Rifugio hike',
    })
    expect(created.status).toBe(201)
    expect(created.body.item.trip_id).toBe(tripId)

    const trip2List = await auth(request(app).get(`/api/trips/${tripId}/itinerary`))
    expect(trip2List.body.items.map((i: { title: string }) => i.title)).toEqual(['Rifugio hike'])

    // trip-1's list is untouched, and doesn't see trip-2's item
    const trip1List = await auth(request(app).get('/api/trips/trip-1/itinerary'))
    expect(trip1List.body.items.map((i: { id: string }) => i.id)).toEqual([
      'itin-ramen',
      'itin-walk',
    ])
  })

  it('404s for an unknown trip', async () => {
    const res = await auth(request(app).get('/api/trips/nope/itinerary'))
    expect(res.status).toBe(404)
  })
})
