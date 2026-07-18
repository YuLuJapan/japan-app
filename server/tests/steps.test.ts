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

describe('POST /api/steps', () => {
  it('creates a step for an existing zone', async () => {
    const res = await auth(
      request(app).post('/api/steps').send({
        zone_id: 'zone-kyoto',
        start_date: '2026-10-12',
        end_date: '2026-10-14',
      })
    )
    expect(res.status).toBe(201)
    expect(res.body.step).toMatchObject({
      zone_id: 'zone-kyoto',
      start_date: '2026-10-12',
      end_date: '2026-10-14',
    })
  })

  it('400 VALIDATION for missing zone_id/destination or bad dates', async () => {
    const res = await auth(
      request(app).post('/api/steps').send({ start_date: 'nope', end_date: '2026-10-14' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('400 VALIDATION when end_date is before start_date', async () => {
    const res = await auth(
      request(app).post('/api/steps').send({
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
      request(app).post('/api/steps').send({
        zone_id: 'zone-nope',
        start_date: '2026-10-12',
        end_date: '2026-10-14',
      })
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/steps with a free-text destination', () => {
  it('reuses an existing zone when the destination name matches (case-insensitive)', async () => {
    const res = await auth(
      request(app)
        .post('/api/steps')
        .send({
          destination: { name: 'kyoto', address: 'Kyoto, Japan', lat: 35.0116, lng: 135.7681 },
          start_date: '2026-10-12',
          end_date: '2026-10-14',
        })
    )
    expect(res.status).toBe(201)
    expect(res.body.step.zone_id).toBe('zone-kyoto')
  })

  it('creates a new zone for a destination that matches nothing in the catalog', async () => {
    const res = await auth(
      request(app)
        .post('/api/steps')
        .send({
          destination: { name: 'Nara', address: 'Nara, Japan', lat: 34.6851, lng: 135.8048 },
          start_date: '2026-10-12',
          end_date: '2026-10-14',
        })
    )
    expect(res.status).toBe(201)
    expect(['zone-tokyo', 'zone-kyoto']).not.toContain(res.body.step.zone_id)

    const trip = await auth(request(app).get('/api/trip'))
    const created = trip.body.steps.find((s: { id: string }) => s.id === res.body.step.id)
    expect(created.zone).toMatchObject({ name: 'Nara', lat: 34.6851, lng: 135.8048 })
  })

  it('400 VALIDATION when neither zone_id nor destination is given', async () => {
    const res = await auth(
      request(app).post('/api/steps').send({ start_date: '2026-10-12', end_date: '2026-10-14' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('400 VALIDATION for an out-of-range destination lat', async () => {
    const res = await auth(
      request(app)
        .post('/api/steps')
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
        .post('/api/steps')
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
      request(app).post('/api/steps').send({
        zone_id: 'zone-kyoto',
        start_date: '2026-10-01',
        end_date: '2026-10-05',
      })
    )
    expect(res.status).toBe(201)

    const trip = await auth(request(app).get('/api/trip'))
    expect(trip.body.steps.map((s: { id: string }) => s.id)).toEqual([
      res.body.step.id,
      'step-1',
      'step-2',
    ])
  })
})

describe('PATCH /api/steps/:stepId', () => {
  it('updates dates, cross-checking against the merged (existing + patch) values', async () => {
    const res = await auth(request(app).patch('/api/steps/step-1').send({ end_date: '2026-10-06' }))
    expect(res.status).toBe(200)
    expect(res.body.step).toMatchObject({ start_date: '2026-10-05', end_date: '2026-10-06' })
  })

  it('400 VALIDATION when the patched end_date would precede the existing start_date', async () => {
    const res = await auth(request(app).patch('/api/steps/step-1').send({ end_date: '2026-10-01' }))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('404 for unknown step', async () => {
    const res = await auth(
      request(app).patch('/api/steps/step-nope').send({ end_date: '2026-10-06' })
    )
    expect(res.status).toBe(404)
  })

  it('404 for unknown zone', async () => {
    const res = await auth(request(app).patch('/api/steps/step-1').send({ zone_id: 'zone-nope' }))
    expect(res.status).toBe(404)
  })

  it('changes the destination via free text, creating a new zone when unrecognized', async () => {
    const res = await auth(
      request(app)
        .patch('/api/steps/step-1')
        .send({ destination: { name: 'Nara', lat: 34.6851, lng: 135.8048 } })
    )
    expect(res.status).toBe(200)
    expect(res.body.step.zone_id).not.toBe('zone-tokyo')
  })

  it('leaves the zone unchanged when only dates are patched', async () => {
    const res = await auth(request(app).patch('/api/steps/step-1').send({ end_date: '2026-10-07' }))
    expect(res.status).toBe(200)
    expect(res.body.step.zone_id).toBe('zone-tokyo')
  })
})

describe('DELETE /api/steps/:stepId', () => {
  it('removes the step', async () => {
    const del = await auth(request(app).delete('/api/steps/step-1'))
    expect(del.status).toBe(204)

    const trip = await auth(request(app).get('/api/trip'))
    expect(trip.body.steps.map((s: { id: string }) => s.id)).toEqual(['step-2'])
  })

  it('404 for unknown step', async () => {
    const res = await auth(request(app).delete('/api/steps/step-nope'))
    expect(res.status).toBe(404)
  })
})
