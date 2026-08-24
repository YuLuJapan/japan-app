import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { asOwner as auth } from './auth.js'

const app = createApp()

describe('foundation', () => {
  it('GET /api/health works without auth', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  // What the gate calls to check a token before it navigates. /api/auth/verify
  // went with the access codes: there is no code to verify, and a session is
  // either accepted here or it is not.
  it('GET /api/me names the signed-in account', async () => {
    const res = await auth(request(app).get('/api/me'))
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('yuval@example.com')
  })

  it('GET /api/me refuses an unknown token', async () => {
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer nope')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects API calls without a bearer token', async () => {
    const res = await request(app).get('/api/trips/trip-1')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('rejects API calls with a wrong bearer token', async () => {
    const res = await request(app).get('/api/trips/trip-1').set('Authorization', 'Bearer wrong')
    expect(res.status).toBe(401)
  })

  it('unknown /api endpoints return NOT_FOUND envelope', async () => {
    const res = await auth(request(app).get('/api/nope'))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})
