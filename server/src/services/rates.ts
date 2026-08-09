// Daily exchange rates for the money calculator (trip's local currency → USD, ILS).
// Source: open.er-api.com (free, no API key, CORS-friendly, updates daily).
//
// Resilience: every successful fetch is written to the database. If the live
// fetch fails (provider down, network blip, cold start with an empty in-memory
// cache), we fall back to the last rate stored in the DB so the calculator
// keeps working. The in-memory cache (~6h) just avoids hammering the provider.
// Cached per base currency, since each trip can have a different one.
import type { DataStore, ExchangeRates } from '../lib/datastore.js'
import type { CurrencyCode } from '../lib/currency.js'

export type Rates = ExchangeRates

const TTL_MS = 6 * 60 * 60 * 1000

const cache = new Map<string, { at: number; data: Rates }>()

async function fetchLive(base: CurrencyCode, nowMs: number): Promise<Rates> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`)
  const json = (await res.json()) as {
    result?: string
    time_last_update_utc?: string
    rates?: Record<string, number>
  }
  const usd = json.rates?.USD
  const ils = json.rates?.ILS
  if (json.result !== 'success' || typeof usd !== 'number' || typeof ils !== 'number') {
    throw new Error('unexpected rates payload')
  }
  const date = json.time_last_update_utc
    ? new Date(json.time_last_update_utc).toISOString().slice(0, 10)
    : new Date(nowMs).toISOString().slice(0, 10)
  return { base, date, usd, ils }
}

export async function getRates(
  store: DataStore,
  base: CurrencyCode = 'JPY',
  nowMs = Date.now()
): Promise<Rates> {
  const cached = cache.get(base)
  if (cached && nowMs - cached.at < TTL_MS) return cached.data

  try {
    const data = await fetchLive(base, nowMs)
    cache.set(base, { at: nowMs, data })
    // best-effort persist for durable fallback — never fail the request over it
    try {
      await store.saveRates(data)
    } catch {
      /* table may not exist yet, or a transient write error — ignore */
    }
    return data
  } catch (err) {
    // live fetch failed → use the last rate stored in the DB, then memory cache
    try {
      const stored = await store.getLatestRates(base)
      if (stored) {
        cache.set(base, { at: nowMs, data: stored })
        return stored
      }
    } catch {
      /* table may not exist yet — fall through */
    }
    const stale = cache.get(base)
    if (stale) return stale.data
    throw err
  }
}

/** Test hook: clear the in-memory cache so a test starts from a cold state. */
export function __resetRatesCache() {
  cache.clear()
}
