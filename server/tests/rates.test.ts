import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { getRates } from '../src/services/rates.js'
import { TEST_CODE } from './fixture.js'

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_CODE}`)

const payload = {
  result: 'success',
  time_last_update_utc: 'Fri, 11 Jul 2026 00:00:01 +0000',
  rates: { USD: 0.0067, ILS: 0.025 },
}

afterEach(() => vi.restoreAllMocks())

describe('exchange rates', () => {
  it('getRates parses JPY→USD/ILS and the source date', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 })
    )
    // pass a large now to bypass any warm cache from a previous test
    const r = await getRates(Date.now() + 7 * 60 * 60 * 1000)
    expect(r).toMatchObject({ base: 'JPY', usd: 0.0067, ils: 0.025, date: '2026-07-11' })
  })

  it('GET /api/rates requires auth and returns rates', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 })
    )
    expect((await request(app).get('/api/rates')).status).toBe(401)

    const res = await auth(request(app).get('/api/rates'))
    expect(res.status).toBe(200)
    expect(res.body.usd).toBeGreaterThan(0)
    expect(res.body.ils).toBeGreaterThan(0)
  })
})
