// Photo lookup for items that have no picture yet (shopping list today; any
// entity with an image_url could use it). Uses the Wikimedia APIs — keyless,
// free, and the same source the seeded place/zone photos come from, so nothing
// here costs money or needs an account.
//
// Two passes, because a full product name ("Ichikami / Tsubaki shampoo +
// conditioner") rarely matches anything while the brand alone ("Ichikami")
// often does:
//   1. Wikipedia article images — great for brands and shops (Uniqlo, Donki).
//   2. Wikimedia Commons files — broader, catches product and street photos.
// Every failure mode (offline, rate limit, junk payload) returns no results
// rather than throwing: a missing photo must never break saving an item.
import { validation } from '../lib/errors.js'

// Read per call rather than captured at import, so a test can point these at a
// local server it started after this module was loaded. Unset everywhere else,
// which is every deployment.
const wikipedia = () => process.env.WIKIPEDIA_API_URL ?? 'https://en.wikipedia.org/w/api.php'
const commons = () => process.env.COMMONS_API_URL ?? 'https://commons.wikimedia.org/w/api.php'
// Wikimedia's policy expects a descriptive UA with contact info (same as the
// Nominatim call in geocode.ts).
const USER_AGENT = 'yuvaluz-in-japan/0.1 (personal trip planner; https://github.com/lkirsman)'
const TIMEOUT_MS = 4000

export interface ImageResult {
  url: string // full-size image
  thumb_url: string // ~600px version, what the picker shows
  title: string
  source: 'wikipedia' | 'commons'
  source_url: string | null // page to credit / read more
  credit: string | null // author + licence when the API gives us one
}

const cache = new Map<string, { at: number; results: ImageResult[] }>()
const CACHE_TTL_MS = 60 * 60 * 1000

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim()

async function getJson(endpoint: string, params: URLSearchParams): Promise<unknown | null> {
  try {
    const res = await fetch(`${endpoint}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    // offline, timeout, rate limit, bad JSON — all "no photo found"
    return null
  }
}

/** Shape of both APIs: { query: { pages: { <id>: {...} } } }. */
function pagesOf(payload: unknown): Record<string, unknown>[] {
  const pages = (payload as { query?: { pages?: Record<string, unknown> } } | null)?.query?.pages
  if (!pages || typeof pages !== 'object') return []
  return Object.values(pages).filter(
    (p): p is Record<string, unknown> => !!p && typeof p === 'object'
  )
}

async function searchWikipedia(query: string, limit: number): Promise<ImageResult[]> {
  const payload = await getJson(
    wikipedia(),
    new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrsearch: query,
      gsrlimit: String(limit),
      prop: 'pageimages',
      piprop: 'thumbnail|original',
      pithumbsize: '600',
      pilimit: String(limit),
    })
  )
  return pagesOf(payload).flatMap((page) => {
    const thumb = (page.thumbnail as { source?: string } | undefined)?.source
    const original = (page.original as { source?: string } | undefined)?.source
    const title = typeof page.title === 'string' ? page.title : ''
    if (!thumb) return []
    return [
      {
        url: original ?? thumb,
        thumb_url: thumb,
        title,
        source: 'wikipedia' as const,
        source_url: title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` : null,
        credit: 'Wikipedia',
      },
    ]
  })
}

async function searchCommons(query: string, limit: number): Promise<ImageResult[]> {
  const payload = await getJson(
    commons(),
    new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrnamespace: '6', // File:
      gsrsearch: query,
      gsrlimit: String(limit),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: '600',
    })
  )
  return pagesOf(payload).flatMap((page) => {
    const info = (page.imageinfo as Record<string, unknown>[] | undefined)?.[0]
    if (!info) return []
    const url = typeof info.url === 'string' ? info.url : ''
    const thumb = typeof info.thumburl === 'string' ? info.thumburl : url
    // search also returns svg/tiff/video files — keep what an <img> can show
    if (!IMAGE_EXT.test(url)) return []
    const meta = (info.extmetadata ?? {}) as Record<string, { value?: string }>
    const author = meta.Artist?.value ? stripHtml(meta.Artist.value) : null
    const licence = meta.LicenseShortName?.value ? stripHtml(meta.LicenseShortName.value) : null
    return [
      {
        url,
        thumb_url: thumb,
        title: typeof page.title === 'string' ? page.title.replace(/^File:/, '') : '',
        source: 'commons' as const,
        source_url: typeof info.descriptionurl === 'string' ? info.descriptionurl : null,
        credit: [author, licence].filter(Boolean).join(' · ') || 'Wikimedia Commons',
      },
    ]
  })
}

/** The brand is usually the first word or two — a better query than the full name. */
function shortenQuery(query: string): string | null {
  const words = query
    .replace(/[/+|,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length <= 2) return null
  return words.slice(0, 2).join(' ')
}

/** Search the web for photos matching `query`. Never throws on network trouble. */
export async function searchImages(query: string, limit = 8): Promise<ImageResult[]> {
  const q = query.trim()
  if (q.length < 2) throw validation(['q must be at least 2 characters'])

  const key = `${q.toLowerCase()}|${limit}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results

  const collect = async (term: string) => {
    const [wiki, commons] = await Promise.all([
      searchWikipedia(term, limit),
      searchCommons(term, limit),
    ])
    return [...wiki, ...commons]
  }

  let found = await collect(q)
  // nothing for the full name? retry on the brand words alone
  const short = shortenQuery(q)
  if (found.length === 0 && short) found = await collect(short)

  const seen = new Set<string>()
  const results = found.filter((r) => !seen.has(r.url) && seen.add(r.url)).slice(0, limit)

  cache.set(key, { at: Date.now(), results })
  return results
}

/**
 * Best photo for `query`, or null. Used to fill in an item saved without one —
 * best-effort by design, so a lookup failure leaves the item photo-less instead
 * of failing the save.
 */
export async function findImageUrl(query: string): Promise<string | null> {
  try {
    const [best] = await searchImages(query, 4)
    return best?.url ?? null
  } catch {
    return null
  }
}
