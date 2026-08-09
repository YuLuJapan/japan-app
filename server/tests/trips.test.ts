import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { TEST_CODE, fixture } from './fixture.js'

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()
const auth = () => request(app).get('/api/trips').set('Authorization', `Bearer ${TEST_CODE}`)

beforeEach(() => setDataStore(createMemoryStore(fixture())))

describe('trips', () => {
  it('GET /api/trips lists the seeded trip with its travellers', async () => {
    const res = await auth()
    expect(res.status).toBe(200)
    expect(res.body.trips).toHaveLength(1)
    expect(res.body.trips[0]).toMatchObject({
      id: 'trip-1',
      name: 'Test Trip',
      people: [{ name: 'Alex' }, { name: 'Sam' }],
    })
  })

  it('GET /api/trip (legacy) still returns the oldest trip bundle', async () => {
    const res = await request(app).get('/api/trip').set('Authorization', `Bearer ${TEST_CODE}`)
    expect(res.status).toBe(200)
    expect(res.body.trip.id).toBe('trip-1')
  })

  it('POST /api/trips creates a second trip without disturbing the first', async () => {
    const create = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${TEST_CODE}`)
      .send({
        name: 'Dolomites',
        start_date: '2027-02-06',
        end_date: '2027-02-14',
        // legacy plain-string travellers are still accepted and normalized
        people: ['Alex', ' Sam '],
      })
    expect(create.status).toBe(201)
    expect(create.body.trip).toMatchObject({
      name: 'Dolomites',
      people: [{ name: 'Alex' }, { name: 'Sam' }],
    })

    const list = await auth()
    expect(list.body.trips.map((t: { name: string }) => t.name)).toEqual(['Test Trip', 'Dolomites'])

    // legacy single-trip route is unaffected by the new trip existing
    const legacy = await request(app).get('/api/trip').set('Authorization', `Bearer ${TEST_CODE}`)
    expect(legacy.body.trip.id).toBe('trip-1')
  })

  it('POST /api/trips rejects a missing name and end before start', async () => {
    const res = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${TEST_CODE}`)
      .send({ name: '', start_date: '2027-02-14', end_date: '2027-02-06' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.stringContaining('name'), expect.stringContaining('end_date')])
    )
  })

  it('GET /api/trips/:tripId 404s for an unknown trip', async () => {
    const res = await request(app)
      .get('/api/trips/nope')
      .set('Authorization', `Bearer ${TEST_CODE}`)
    expect(res.status).toBe(404)
  })

  it('PATCH /api/trips/:tripId updates travellers (with an email) and dates', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set('Authorization', `Bearer ${TEST_CODE}`)
      .send({ people: [{ name: 'Alex' }, { name: 'Sam', email: 'sam@example.com' }, 'Noa'] })
    expect(res.status).toBe(200)
    expect(res.body.trip.people).toEqual([
      { name: 'Alex' },
      { name: 'Sam', email: 'sam@example.com' },
      { name: 'Noa' },
    ])
    expect(res.body.trip.start_date).toBe('2026-10-01') // untouched fields survive a partial patch
  })

  it('PATCH /api/trips/:tripId rejects an invalid traveller email', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set('Authorization', `Bearer ${TEST_CODE}`)
      .send({ people: [{ name: 'Alex', email: 'not-an-email' }] })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('PATCH /api/trips/:tripId refuses dates that would strand a stop or an activity', async () => {
    // fixture: trip 2026-10-01→14, steps 10-05→09 and 10-09→12, activities on 10-06
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set('Authorization', `Bearer ${TEST_CODE}`)
      .send({ start_date: '2026-10-07', end_date: '2026-10-14' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    const details = res.body.error.details.join(' ')
    expect(details).toMatch(/journey stop/i)
    expect(details).toMatch(/2026-10-06/) // the stranded activity's day is named

    const unchanged = await request(app)
      .get('/api/trips/trip-1')
      .set('Authorization', `Bearer ${TEST_CODE}`)
    expect(unchanged.body.trip.start_date).toBe('2026-10-01')
  })

  it('PATCH /api/trips/:tripId allows a date change that still covers everything planned', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set('Authorization', `Bearer ${TEST_CODE}`)
      .send({ start_date: '2026-10-04', end_date: '2026-10-20' })
    expect(res.status).toBe(200)
    expect(res.body.trip).toMatchObject({ start_date: '2026-10-04', end_date: '2026-10-20' })
  })

  it('DELETE /api/trips/:tripId removes the trip and cascades its children', async () => {
    const del = await request(app)
      .delete('/api/trips/trip-1')
      .set('Authorization', `Bearer ${TEST_CODE}`)
    expect(del.status).toBe(204)

    const list = await auth()
    expect(list.body.trips).toEqual([])

    // children scoped to trip-1 (steps, itinerary, shopping) go with it
    const itinerary = await request(app)
      .get('/api/itinerary')
      .set('Authorization', `Bearer ${TEST_CODE}`)
    expect(itinerary.status).toBe(404) // no trips left for the legacy default-trip routes to fall back to
  })

  it('guests cannot create, update or delete trips', async () => {
    process.env.TRIP_GUEST_CODE = 'guest-code'
    const guestAuth = 'Bearer guest-code'
    const create = await request(app)
      .post('/api/trips')
      .set('Authorization', guestAuth)
      .send({ name: 'Nope', start_date: '2027-01-01', end_date: '2027-01-02' })
    expect(create.status).toBe(403)
    const patch = await request(app)
      .patch('/api/trips/trip-1')
      .set('Authorization', guestAuth)
      .send({})
    expect(patch.status).toBe(403)
    const del = await request(app).delete('/api/trips/trip-1').set('Authorization', guestAuth)
    expect(del.status).toBe(403)
    delete process.env.TRIP_GUEST_CODE
  })
})
