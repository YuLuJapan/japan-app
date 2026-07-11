// Daily exchange rates for the money calculator (JPY → USD, ILS).
// Source: open.er-api.com (free, no API key, CORS-friendly, updates daily).
// Cached in-memory ~6h; on a fetch error we serve the last good value so the
// calculator keeps working (and the PWA caches the response for offline use).

export interface Rates {
  base: 'JPY'
  date: string // YYYY-MM-DD (source update date)
  usd: number // 1 JPY in USD
  ils: number // 1 JPY in ILS
}

const TTL_MS = 6 * 60 * 60 * 1000
const SOURCE = 'https://open.er-api.com/v6/latest/JPY'

let cache: { at: number; data: Rates } | null = null

export async function getRates(nowMs = Date.now()): Promise<Rates> {
  if (cache && nowMs - cache.at < TTL_MS) return cache.data
  try {
    const res = await fetch(SOURCE)
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
    const data: Rates = { base: 'JPY', date, usd, ils }
    cache = { at: nowMs, data }
    return data
  } catch (err) {
    if (cache) return cache.data // stale but usable
    throw err
  }
}
