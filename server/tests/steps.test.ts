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

describe('POST /api/trips/trip-1/steps', () => {
  it('creates a step for an existing zone', async () => {
    const res = await auth(
      request(app).post('/api/trips/trip-1/steps').send({
        zone_id: 'zone-kyoto',
        start_date: '2026-10-12',
        end_date: '2026-10-14',
      })
    )
    expect(res.status).toBe(201)
    // The journey-card shape, the same one the trip bundle lists: the zone
    // itself rather than its id, so the client can render what it just saved.
    expect(res.body.step).toMatchObject({
      start_date: '2026-10-12',
      end_date: '2026-10-14',
      zone: expect.objectContaining({ id: 'zone-kyoto', name: 'Kyoto' }),
    })
    expect(res.body.step.zone.saved_counts).toBeDefined()
  })

  it('400 VALIDATION for missing zone_id/destination or bad dates', async () => {
    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/steps')
        .send({ start_date: 'nope', end_date: '2026-10-14' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('400 VALIDATION when end_date is before start_date', async () => {
    const res = await auth(
      request(app).post('/api/trips/trip-1/steps').send({
        zone_id: 'zone-kyoto',
        start_date: '2026-10-14',
        end_date: '2026-10-12',
      })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('404 for unknown zone', async () => {
    const res = await auth(
      request(app).post('/api/trips/trip-1/steps').send({
        zone_id: 'zone-nope',
        start_date: '2026-10-12',
        end_date: '2026-10-14',
      })
    )
    expect(res.status).toBe(404)
  })

  it("400 VALIDATION when the step's dates fall outside the trip's own dates", async () => {
    // fixture trip-1 runs 2026-10-01 → 2026-10-14
    const res = await auth(
      request(app).post('/api/trips/trip-1/steps').send({
        zone_id: 'zone-kyoto',
        start_date: '2026-09-28',
        end_date: '2026-10-02',
      })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(res.body.error.details.some((d: string) => d.includes('start_date'))).toBe(true)
  })
})

describe('POST /api/steps with a free-text destination', () => {
  it('reuses an existing zone when the destination name matches (case-insensitive)', async () => {
    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/steps')
        .send({
          destination: { name: 'kyoto', address: 'Kyoto, Japan', lat: 35.0116, lng: 135.7681 },
          start_date: '2026-10-12',
          end_date: '2026-10-14',
        })
    )
    expect(res.status).toBe(201)
    expect(res.body.step.zone.id).toBe('zone-kyoto')
  })

  it('creates a new zone for a destination that matches nothing in the catalog', async () => {
    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/steps')
        .send({
          destination: { name: 'Nara', address: 'Nara, Japan', lat: 34.6851, lng: 135.8048 },
          start_date: '2026-10-12',
          end_date: '2026-10-14',
        })
    )
    expect(res.status).toBe(201)
    expect(['zone-tokyo', 'zone-kyoto']).not.toContain(res.body.step.zone.id)

    const trip = await auth(request(app).get('/api/trips/trip-1'))
    const created = trip.body.steps.find((s: { id: string }) => s.id === res.body.step.id)
    expect(created.zone).toMatchObject({ name: 'Nara', lat: 34.6851, lng: 135.8048 })
  })

  it('400 VALIDATION when neither zone_id nor destination is given', async () => {
    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/steps')
        .send({ start_date: '2026-10-12', end_date: '2026-10-14' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('400 VALIDATION for an out-of-range destination lat', async () => {
    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/steps')
        .send({
          destination: { name: 'Nowhere', lat: 999, lng: 0 },
          start_date: '2026-10-12',
          end_date: '2026-10-14',
        })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('400 VALIDATION for a missing destination name', async () => {
    const res = await auth(
      request(app)
        .post('/api/trips/trip-1/steps')
        .send({
          destination: { name: '  ', lat: 34.6851, lng: 135.8048 },
          start_date: '2026-10-12',
          end_date: '2026-10-14',
        })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })
})

describe('step ordering', () => {
  it('orders steps by start_date, not creation order — an earlier destination sorts first', async () => {
    // fixture: step-1 zone-tokyo (2026-10-05→09), step-2 zone-kyoto (2026-10-09→12)
    const res = await auth(
      request(app).post('/api/trips/trip-1/steps').send({
        zone_id: 'zone-kyoto',
        start_date: '2026-10-01',
        end_date: '2026-10-05',
      })
    )
    expect(res.status).toBe(201)

    const trip = await auth(request(app).get('/api/trips/trip-1'))
    expect(trip.body.steps.map((s: { id: string }) => s.id)).toEqual([
      res.body.step.id,
      'step-1',
      'step-2',
    ])
  })
})

describe('PATCH /api/trips/trip-1/steps/:stepId', () => {
  it('updates dates, cross-checking against the merged (existing + patch) values', async () => {
    const res = await auth(
      request(app).patch('/api/trips/trip-1/steps/step-1').send({ end_date: '2026-10-06' })
    )
    expect(res.status).toBe(200)
    expect(res.body.step).toMatchObject({ start_date: '2026-10-05', end_date: '2026-10-06' })
  })

  it('400 VALIDATION when the patched end_date would precede the existing start_date', async () => {
    const res = await auth(
      request(app).patch('/api/trips/trip-1/steps/step-1').send({ end_date: '2026-10-01' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('404 for unknown step', async () => {
    const res = await auth(
      request(app).patch('/api/trips/trip-1/steps/step-nope').send({ end_date: '2026-10-06' })
    )
    expect(res.status).toBe(404)
  })

  it("400 VALIDATION when a patched date would fall outside the trip's own dates", async () => {
    const res = await auth(
      request(app).patch('/api/trips/trip-1/steps/step-1').send({ end_date: '2026-10-20' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('404 for unknown zone', async () => {
    const res = await auth(
      request(app).patch('/api/trips/trip-1/steps/step-1').send({ zone_id: 'zone-nope' })
    )
    expect(res.status).toBe(404)
  })

  it('changes the destination via free text, creating a new zone when unrecognized', async () => {
    const res = await auth(
      request(app)
        .patch('/api/trips/trip-1/steps/step-1')
        .send({ destination: { name: 'Nara', lat: 34.6851, lng: 135.8048 } })
    )
    expect(res.status).toBe(200)
    expect(res.body.step.zone.id).not.toBe('zone-tokyo')
  })

  it('leaves the zone unchanged when only dates are patched', async () => {
    const res = await auth(
      request(app).patch('/api/trips/trip-1/steps/step-1').send({ end_date: '2026-10-07' })
    )
    expect(res.status).toBe(200)
    expect(res.body.step.zone.id).toBe('zone-tokyo')
  })
})

describe('DELETE /api/trips/trip-1/steps/:stepId', () => {
  it('removes the step', async () => {
    const del = await auth(request(app).delete('/api/trips/trip-1/steps/step-1'))
    expect(del.status).toBe(204)

    const trip = await auth(request(app).get('/api/trips/trip-1'))
    expect(trip.body.steps.map((s: { id: string }) => s.id)).toEqual(['step-2'])
  })

  it('404 for unknown step', async () => {
    const res = await auth(request(app).delete('/api/trips/trip-1/steps/step-nope'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/trips/:tripId/steps', () => {
  it('creates the step under the given trip, with its own zone', async () => {
    const trip2 = await auth(request(app).post('/api/trips')).send({
      name: 'Dolomites',
      start_date: '2027-02-06',
      end_date: '2027-02-14',
    })
    const tripId = trip2.body.trip.id

    // A new trip cannot borrow another trip's city: since migration 0013 a
    // zone belongs to exactly one trip, so this is the same answer an
    // outsider gets.
    const borrowed = await auth(request(app).post(`/api/trips/${tripId}/steps`)).send({
      zone_id: 'zone-tokyo',
      start_date: '2027-02-07',
      end_date: '2027-02-10',
    })
    expect(borrowed.status).toBe(404)

    // It gets its own Tokyo instead — same name, different row, its own places.
    const res = await auth(request(app).post(`/api/trips/${tripId}/steps`)).send({
      destination: { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.68, lng: 139.76 },
      start_date: '2027-02-07',
      end_date: '2027-02-10',
    })
    expect(res.status).toBe(201)
    expect(res.body.step.zone.id).not.toBe('zone-tokyo')
    // The card shape carries no trip id — it is a row of one trip's journey by
    // construction. That the step landed on the right trip is asserted where
    // it matters, on that trip's own journey.
    const own = await auth(request(app).get(`/api/trips/${tripId}`))
    expect(own.body.steps.map((s: { id: string }) => s.id)).toEqual([res.body.step.id])

    // trip-1's steps are untouched
    const trip = await auth(request(app).get('/api/trips/trip-1'))
    expect(trip.body.steps.map((s: { id: string }) => s.id)).toEqual(['step-1', 'step-2'])
  })

  it('404s for an unknown trip', async () => {
    const res = await auth(request(app).post('/api/trips/nope/steps')).send({
      zone_id: 'zone-tokyo',
      start_date: '2027-02-07',
      end_date: '2027-02-10',
    })
    expect(res.status).toBe(404)
  })
})
