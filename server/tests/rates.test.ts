import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { __resetRatesCache, getRates } from '../src/services/rates.js'
import { TEST_CODE, fixture } from './fixture.js'

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_CODE}`)

const payload = {
  result: 'success',
  time_last_update_utc: 'Fri, 11 Jul 2026 00:00:01 +0000',
  rates: { USD: 0.0067, ILS: 0.025 },
}

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  __resetRatesCache()
})
afterEach(() => vi.restoreAllMocks())

describe('exchange rates', () => {
  it('getRates parses JPY→USD/ILS and the source date, and persists them', async () => {
    const store = createMemoryStore(fixture())
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 })
    )
    const r = await getRates(store)
    expect(r).toMatchObject({ base: 'JPY', usd: 0.0067, ils: 0.025, date: '2026-07-11' })
    // it was written to the store for durable fallback
    expect(await store.getLatestRates('JPY')).toMatchObject({ usd: 0.0067, ils: 0.025 })
  })

  it('fetches per base currency and caches them independently', async () => {
    const store = createMemoryStore(fixture())
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 }))

    await getRates(store, 'GBP')
    await getRates(store, 'JPY')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0][0]).toContain('/latest/GBP')
    expect(fetchSpy.mock.calls[1][0]).toContain('/latest/JPY')

    // cached — no further live fetches for either base
    await getRates(store, 'GBP')
    await getRates(store, 'JPY')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('falls back to the last DB rate when the live fetch fails', async () => {
    const store = createMemoryStore(fixture())
    await store.saveRates({ base: 'JPY', date: '2026-07-10', usd: 0.0065, ils: 0.024 })

    __resetRatesCache()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    const r = await getRates(store)
    expect(r).toMatchObject({ base: 'JPY', date: '2026-07-10', usd: 0.0065, ils: 0.024 })
  })

  it('throws only when the fetch fails AND there is no stored rate', async () => {
    const store = createMemoryStore(fixture()) // no saved rate
    __resetRatesCache()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    await expect(getRates(store)).rejects.toThrow()
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

  it('GET /api/rates?base=GBP returns rates for that base', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 })
    )
    const res = await auth(request(app).get('/api/rates?base=GBP'))
    expect(res.status).toBe(200)
    expect(res.body.base).toBe('GBP')
  })

  it('GET /api/rates?base=XXX rejects an unsupported currency code', async () => {
    const res = await auth(request(app).get('/api/rates?base=XXX'))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })
})
