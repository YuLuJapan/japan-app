import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { getDataStore } from '../src/lib/datastore.js'
import { __resetRatesCache, getRates, getRatesFor } from '../src/services/rates.js'
import { asOwner as auth } from './auth.js'

const app = createApp()

const payload = {
  result: 'success',
  time_last_update_utc: 'Fri, 11 Jul 2026 00:00:01 +0000',
  rates: { USD: 0.0067, ILS: 0.025, EUR: 0.0058 },
}

/** The provider answers for whichever base the URL asks for. */
function mockProvider(byBase: Record<string, object> = { JPY: payload }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const base = String(input).split('/').pop() ?? ''
    const body = byBase[base]
    if (!body) throw new Error(`no mock for base ${base}`)
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

beforeEach(() => {
  __resetRatesCache()
})
afterEach(() => vi.restoreAllMocks())

describe('exchange rates', () => {
  it('getRates parses the quoted rates and the source date, and persists them', async () => {
    const store = await getDataStore()
    mockProvider()
    const r = await getRates(store, 'JPY')
    expect(r).toMatchObject({ base: 'JPY', date: '2026-07-11' })
    expect(r.rates).toMatchObject({ USD: 0.0067, ILS: 0.025, EUR: 0.0058 })
    // it was written to the store for durable fallback
    expect((await store.getLatestRates('JPY'))?.rates).toMatchObject({ USD: 0.0067 })
  })

  it('fetches per base, and one base never answers for another', async () => {
    const store = await getDataStore()
    mockProvider({
      JPY: payload,
      EUR: { ...payload, rates: { USD: 1.16, ILS: 4.3 } },
    })
    expect((await getRates(store, 'JPY')).rates.USD).toBe(0.0067)
    expect((await getRates(store, 'EUR')).rates.USD).toBe(1.16)
    // each base keeps its own stored fallback
    expect((await store.getLatestRates('EUR'))?.rates.USD).toBe(1.16)
    expect((await store.getLatestRates('JPY'))?.rates.USD).toBe(0.0067)
  })

  it('falls back to the last DB rate for that base when the live fetch fails', async () => {
    const store = await getDataStore()
    await store.saveRates({ base: 'JPY', date: '2026-07-10', rates: { USD: 0.0065, ILS: 0.024 } })

    __resetRatesCache()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    const r = await getRates(store, 'JPY')
    expect(r).toMatchObject({ base: 'JPY', date: '2026-07-10' })
    expect(r.rates.ILS).toBe(0.024)
  })

  it('throws only when the fetch fails AND there is no stored rate', async () => {
    const store = await getDataStore() // no saved rate
    __resetRatesCache()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    await expect(getRates(store, 'JPY')).rejects.toThrow()
  })

  it('getRatesFor keeps the symbols asked for and names the ones with no rate', async () => {
    const store = await getDataStore()
    mockProvider()
    const r = await getRatesFor(store, { base: 'JPY', symbols: 'USD,THB,usd' })
    expect(r.rates).toEqual({ USD: 0.0067 })
    expect(r.missing).toEqual(['THB'])
  })

  it('getRatesFor rejects a currency we cannot quote', async () => {
    const store = await getDataStore()
    await expect(getRatesFor(store, { base: 'XYZ' })).rejects.toMatchObject({ status: 400 })
    await expect(getRatesFor(store, { symbols: 'USD,XYZ' })).rejects.toMatchObject({ status: 400 })
  })

  it('GET /api/rates requires auth and answers for the base asked for', async () => {
    mockProvider({ JPY: payload, EUR: { ...payload, rates: { ILS: 3.9 } } })
    expect((await request(app).get('/api/rates')).status).toBe(401)

    const res = await auth(request(app).get('/api/rates?symbols=USD,ILS'))
    expect(res.status).toBe(200)
    expect(res.body.base).toBe('JPY') // the default, as before the base was a choice
    expect(res.body.rates.USD).toBeGreaterThan(0)
    expect(res.body.rates.ILS).toBeGreaterThan(0)

    const euro = await auth(request(app).get('/api/rates?base=EUR&symbols=ILS'))
    expect(euro.status).toBe(200)
    expect(euro.body).toMatchObject({ base: 'EUR', rates: { ILS: 3.9 } })

    const bad = await auth(request(app).get('/api/rates?base=nope'))
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('VALIDATION')
  })

  it('GET /api/currencies lists what a trip can be priced in', async () => {
    expect((await request(app).get('/api/currencies')).status).toBe(401)

    const res = await auth(request(app).get('/api/currencies'))
    expect(res.status).toBe(200)
    expect(res.body.currencies).toContainEqual({ code: 'JPY', name: 'Japanese Yen' })
    expect(res.body.by_country.japan).toBe('JPY')
  })
})
