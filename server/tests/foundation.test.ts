import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { TEST_CODE, fixture } from './fixture.js'

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()

beforeEach(() => setDataStore(createMemoryStore(fixture())))

describe('foundation', () => {
  it('GET /api/health works without auth', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('POST /api/auth/verify accepts the right code', async () => {
    const res = await request(app).post('/api/auth/verify').send({ code: TEST_CODE })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('POST /api/auth/verify rejects a wrong code', async () => {
    const res = await request(app).post('/api/auth/verify').send({ code: 'nope' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects API calls without a bearer token', async () => {
    const res = await request(app).get('/api/trip')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects API calls with a wrong bearer token', async () => {
    const res = await request(app).get('/api/trip').set('Authorization', 'Bearer wrong')
    expect(res.status).toBe(401)
  })

  it('unknown /api endpoints return NOT_FOUND envelope', async () => {
    const res = await request(app).get('/api/nope').set('Authorization', `Bearer ${TEST_CODE}`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})
