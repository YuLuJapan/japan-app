// Daily exchange rates for the money calculator.
//
// The base is the trip's local currency and the symbols are its home
// currencies (see lib/currencies.ts) — nothing here is JPY-specific any more;
// JPY is only the default a trip gets when nobody picked.
// Source: open.er-api.com (free, no API key, CORS-friendly, updates daily).
//
// Resilience: every successful fetch is written to the database. If the live
// fetch fails (provider down, network blip, cold start with an empty in-memory
// cache), we fall back to the last rate stored in the DB *for that base* so the
// calculator keeps working. The in-memory cache (~6h) just avoids hammering the
// provider. Both are keyed by base: a trip in euros and one in yen never share
// an entry.
import type { DataStore, ExchangeRates } from '../lib/datastore.js'
import { DEFAULT_LOCAL_CURRENCY, normalizeCurrency } from '../lib/currencies.js'
import { validation } from '../lib/errors.js'

export type Rates = ExchangeRates

const TTL_MS = 6 * 60 * 60 * 1000
// Read per call rather than captured at import, so a test can point this at a
// local server it started after this module was loaded. Unset everywhere else,
// which is every deployment.
const source = () => process.env.EXCHANGE_RATES_URL ?? 'https://open.er-api.com/v6/latest'

const cache = new Map<string, { at: number; data: Rates }>()

async function fetchLive(base: string, nowMs: number): Promise<Rates> {
  const res = await fetch(`${source()}/${base}`)
  const json = (await res.json()) as {
    result?: string
    time_last_update_utc?: string
    rates?: Record<string, number>
  }
  const rates: Record<string, number> = {}
  for (const [code, value] of Object.entries(json.rates ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) rates[code.toUpperCase()] = value
  }
  if (json.result !== 'success' || !Object.keys(rates).length) {
    throw new Error('unexpected rates payload')
  }
  const date = json.time_last_update_utc
    ? new Date(json.time_last_update_utc).toISOString().slice(0, 10)
    : new Date(nowMs).toISOString().slice(0, 10)
  return { base, date, rates }
}

/**
 * Every rate quoted from `base`. Callers pick the currencies they need out of
 * `rates` — one fetch per base serves any set of them.
 */
export async function getRates(
  store: DataStore,
  base: string = DEFAULT_LOCAL_CURRENCY,
  nowMs = Date.now()
): Promise<Rates> {
  const code = normalizeCurrency(base) ?? DEFAULT_LOCAL_CURRENCY
  const cached = cache.get(code)
  if (cached && nowMs - cached.at < TTL_MS) return cached.data

  try {
    const data = await fetchLive(code, nowMs)
    cache.set(code, { at: nowMs, data })
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
      const stored = await store.getLatestRates(code)
      if (stored) {
        cache.set(code, { at: nowMs, data: stored })
        return stored
      }
    } catch {
      /* table may not exist yet — fall through */
    }
    if (cached) return cached.data
    throw err
  }
}

export interface RatesQuery {
  base?: string
  /** Comma-separated codes; absent means "everything the provider quotes". */
  symbols?: string
}

/**
 * The calculator's read: rates from one currency into the handful asked for.
 *
 * A requested code with no rate is named in `missing` rather than silently
 * dropped — the UI says "no rate for X today" instead of showing a blank card.
 */
export async function getRatesFor(store: DataStore, query: RatesQuery = {}) {
  const errors: string[] = []
  const base = query.base === undefined ? DEFAULT_LOCAL_CURRENCY : normalizeCurrency(query.base)
  if (!base) errors.push('base must be a supported 3-letter currency code')

  const requested = (query.symbols ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const symbols: string[] = []
  for (const symbol of requested) {
    const code = normalizeCurrency(symbol)
    if (!code) errors.push(`symbols must be supported currency codes (got ${symbol})`)
    else if (!symbols.includes(code)) symbols.push(code)
  }
  if (errors.length) throw validation(errors)

  const all = await getRates(store, base!)
  if (!symbols.length) return { ...all, missing: [] as string[] }

  const rates: Record<string, number> = {}
  const missing: string[] = []
  for (const code of symbols) {
    // Quoting a currency against itself is 1, and the provider agrees — but
    // it costs nothing to be sure the card always has a number.
    if (code === all.base) rates[code] = 1
    else if (typeof all.rates[code] === 'number') rates[code] = all.rates[code]
    else missing.push(code)
  }
  return { base: all.base, date: all.date, rates, missing }
}

/** Test hook: clear the in-memory cache so a test starts from a cold state. */
export function __resetRatesCache() {
  cache.clear()
}
