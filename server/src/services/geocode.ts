// Place search / geocoding via OpenStreetMap Nominatim (no API key).
// Proxied through the server so we can send the User-Agent Nominatim's usage
// policy requires and so the browser isn't subject to per-origin CORS quirks.
// Results are biased toward the city the search was launched from and cached
// briefly to stay well under the 1 req/sec policy. Defaults to Japan-only
// (this app is a Japan trip planner); pass global:true to search worldwide,
// e.g. for a journey destination that isn't in Japan (a layover city).
import { validation } from '../lib/errors.js'

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
// Identifies the app per the Nominatim usage policy (a contact/URL is expected).
const USER_AGENT = 'yuvaluz-in-japan/0.1 (personal trip planner; https://github.com/lkirsman)'

export interface GeocodeResult {
  name: string
  address: string | null
  lat: number
  lng: number
}

interface NominatimPlace {
  display_name?: string
  name?: string
  lat: string
  lon: string
  type?: string
  addresstype?: string
}

const cache = new Map<string, { at: number; results: GeocodeResult[] }>()
const CACHE_TTL_MS = 10 * 60 * 1000

/** Search for places matching `query`, optionally biased around a lat/lng. */
export async function geocodeSearch(
  query: string,
  bias?: { lat: number; lng: number },
  opts?: { global?: boolean }
): Promise<GeocodeResult[]> {
  const q = query.trim()
  if (q.length < 2) throw validation(['query must be at least 2 characters'])

  const global = opts?.global ?? false
  const key = `${q.toLowerCase()}|${bias ? `${bias.lat.toFixed(2)},${bias.lng.toFixed(2)}` : ''}|${global ? 'global' : 'jp'}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results

  const params = new URLSearchParams({
    format: 'jsonv2',
    q,
    limit: '6',
    addressdetails: '0',
  })
  if (!global) params.set('countrycodes', 'jp')
  if (bias) {
    // ~0.6° box around the city so nearby matches rank first (bounded=0 still
    // allows farther results when nothing nearby matches).
    const d = 0.6
    params.set('viewbox', `${bias.lng - d},${bias.lat - d},${bias.lng + d},${bias.lat + d}`)
    params.set('bounded', '0')
  }

  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    })
  } catch {
    // network blip → empty results rather than a 500 (search is best-effort)
    return []
  }
  if (!res.ok) return []

  const raw = (await res.json().catch(() => [])) as NominatimPlace[]
  const results: GeocodeResult[] = raw
    .map((p) => {
      const lat = Number(p.lat)
      const lng = Number(p.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      const full = p.display_name ?? p.name ?? ''
      // Nominatim's display_name leads with the specific name; keep it short.
      const name = full.split(',')[0]?.trim() || full
      const rest = full.slice(name.length).replace(/^,\s*/, '').trim()
      return { name, address: rest || null, lat, lng }
    })
    .filter((r): r is GeocodeResult => r !== null)

  cache.set(key, { at: Date.now(), results })
  return results
}
