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

describe('itinerary', () => {
  it('GET /api/itinerary returns the trip items sorted (timed before untimed)', async () => {
    const res = await auth(request(app).get('/api/itinerary'))
    expect(res.status).toBe(200)
    const ids = res.body.items.map((i: { id: string }) => i.id)
    expect(ids).toEqual(['itin-ramen', 'itin-walk']) // 20:00 before "anytime"
  })

  it('POST /api/itinerary creates an item and it appears in the list', async () => {
    const res = await auth(request(app).post('/api/itinerary')).send({
      zone_id: 'zone-kyoto',
      day: '2026-10-10',
      start_time: '09:30',
      title: 'Fushimi Inari',
    })
    expect(res.status).toBe(201)
    expect(res.body.item.id).toBeTruthy()
    expect(res.body.item.trip_id).toBe('trip-1') // trip id is derived, not client-supplied

    const list = await auth(request(app).get('/api/itinerary'))
    expect(list.body.items.map((i: { title: string }) => i.title)).toContain('Fushimi Inari')
  })

  it('POST 400 on missing title, bad day, and bad time', async () => {
    const bad = await auth(request(app).post('/api/itinerary')).send({
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

  it('POST 404 for an unknown zone', async () => {
    const res = await auth(request(app).post('/api/itinerary')).send({
      zone_id: 'zone-nope',
      day: '2026-10-10',
      title: 'Ghost stop',
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/itinerary/:id updates fields; clearing the time is allowed', async () => {
    const res = await auth(request(app).patch('/api/itinerary/itin-ramen')).send({
      title: 'Late-night ramen',
      start_time: '',
    })
    expect(res.status).toBe(200)
    expect(res.body.item.title).toBe('Late-night ramen')
    expect(res.body.item.start_time).toBeNull()
  })

  it('DELETE /api/itinerary/:id removes it; 404 when unknown', async () => {
    expect((await auth(request(app).delete('/api/itinerary/itin-walk'))).status).toBe(204)
    expect((await auth(request(app).delete('/api/itinerary/itin-walk'))).status).toBe(404)
  })

  it('deleting a place keeps its day plan but unlinks it (place_id → null)', async () => {
    const del = await auth(request(app).delete('/api/places/place-ramen'))
    expect(del.status).toBe(204)

    const list = await auth(request(app).get('/api/itinerary'))
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
