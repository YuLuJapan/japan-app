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

describe('GET /api/zones', () => {
  it('lists the trip zone catalog', async () => {
    const res = await auth(request(app).get('/api/zones'))
    expect(res.status).toBe(200)
    expect(res.body.zones.map((z: { name: string }) => z.name).sort()).toEqual(['Kyoto', 'Tokyo'])
  })
})

describe('POST /api/steps', () => {
  it('appends a new stop at the end of the trip', async () => {
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
      position: 3, // fixture already has position 1, 2
      start_date: '2026-10-12',
      end_date: '2026-10-14',
    })

    const trip = await auth(request(app).get('/api/trip'))
    expect(trip.body.steps.map((s: { position: number }) => s.position)).toEqual([1, 2, 3])
  })

  it('400 VALIDATION for missing zone_id or bad dates', async () => {
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
})

describe('DELETE /api/steps/:stepId', () => {
  it('removes the stop and compacts later positions', async () => {
    // fixture: step-1 (Tokyo, position 1), step-2 (Kyoto, position 2)
    const del = await auth(request(app).delete('/api/steps/step-1'))
    expect(del.status).toBe(204)

    const trip = await auth(request(app).get('/api/trip'))
    expect(trip.body.steps).toHaveLength(1)
    expect(trip.body.steps[0]).toMatchObject({ id: 'step-2', position: 1 })
  })

  it('404 for unknown step', async () => {
    const res = await auth(request(app).delete('/api/steps/step-nope'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/steps/:stepId/move', () => {
  it('swaps position with the previous stop when moving up', async () => {
    // fixture: step-1 position 1 (Tokyo), step-2 position 2 (Kyoto)
    const res = await auth(request(app).post('/api/steps/step-2/move').send({ direction: 'up' }))
    expect(res.status).toBe(200)
    const byId = Object.fromEntries(
      res.body.steps.map((s: { id: string; position: number }) => [s.id, s.position])
    )
    expect(byId['step-2']).toBe(1)
    expect(byId['step-1']).toBe(2)
  })

  it('is a no-op when already at the top', async () => {
    const res = await auth(request(app).post('/api/steps/step-1/move').send({ direction: 'up' }))
    expect(res.status).toBe(200)
    const byId = Object.fromEntries(
      res.body.steps.map((s: { id: string; position: number }) => [s.id, s.position])
    )
    expect(byId['step-1']).toBe(1)
    expect(byId['step-2']).toBe(2)
  })

  it('400 VALIDATION for a bad direction', async () => {
    const res = await auth(
      request(app).post('/api/steps/step-1/move').send({ direction: 'sideways' })
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('404 for unknown step', async () => {
    const res = await auth(request(app).post('/api/steps/step-nope/move').send({ direction: 'up' }))
    expect(res.status).toBe(404)
  })
})
