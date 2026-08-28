// "Add a product by pasting its link": fetch the page and read the metadata
// shops already publish for social previews — Open Graph tags and schema.org
// JSON-LD — into the fields of a shopping item.
//
// Deliberately dependency-free: we only need a handful of <meta> tags and the
// occasional JSON-LD block, so a focused parser beats pulling in an HTML
// library for one route.
//
// This endpoint fetches a URL chosen by whoever is holding the phone, from
// inside our server's network, so it is guarded: http(s) only, no private or
// loopback addresses, redirects followed by hand (each hop re-checked), a hard
// timeout and a capped read. It returns parsed fields only — never the page.
import type { DataStore } from '../lib/datastore.js'
import { validation } from '../lib/errors.js'
import { getRates } from './rates.js'
import { containsJapanese, translateJaToEn } from './translate.js'

const TIMEOUT_MS = 6000
const MAX_BYTES = 512 * 1024 // metadata lives in <head>; no need for the whole page
const MAX_REDIRECTS = 3
const USER_AGENT = 'yuvaluz-in-japan/0.1 (personal trip planner; link preview)'

export interface ProductPreview {
  url: string
  name: string | null
  image_url: string | null
  shop: string | null
  price_yen: number | null
  /** Set when a price was found in a currency we could not convert. */
  price_note: string | null
  /** The Japanese name, when `name` is its English translation — worth keeping:
   *  it's what you show staff in the shop. */
  name_ja: string | null
}

/** True when an IP literal belongs to a network we must not reach into. */
function isPrivateAddress(address: string): boolean {
  const h = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true
  // ::ffff:127.0.0.1 — IPv4 wearing an IPv6 hat
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h)
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mapped?.[1] ?? h)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/**
 * A name can point anywhere — localtest.me resolves to 127.0.0.1 — so the
 * literal check below isn't enough on its own. Resolve the host and reject it
 * when any address is internal. A name that doesn't resolve is left alone: the
 * fetch will fail on its own, and we'd rather not fail a real shop over a slow
 * resolver.
 */
async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  try {
    const { lookup } = await import('node:dns/promises')
    const addresses = await lookup(hostname, { all: true })
    return addresses.some((a) => isPrivateAddress(a.address))
  } catch {
    return false
  }
}

/** Hostnames that must never be fetched: our own network, not a shop's. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  )
    return true
  return isPrivateAddress(h)
}

function parseUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw validation(['url must be a valid http(s) link'])
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw validation(['url must start with http:// or https://'])
  if (isBlockedHost(parsed.hostname)) throw validation(['that address cannot be fetched'])
  return parsed
}

/** Fetch the page HTML, following redirects ourselves so every hop is checked. */
async function fetchHtml(start: URL): Promise<{ html: string; finalUrl: URL } | null> {
  let current = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          // ask for English first — international shops often honour it, which
          // saves a translation round trip
          'Accept-Language': 'en-US,en;q=0.9,ja;q=0.5',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      return null // offline, timeout, DNS failure — caller reports "couldn't read it"
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return null
      let next: URL
      try {
        next = new URL(location, current)
      } catch {
        return null
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') return null
      // a redirect into our own network is the classic way past the first check
      if (isBlockedHost(next.hostname) || (await resolvesToPrivateAddress(next.hostname)))
        return null
      current = next
      continue
    }

    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml/i.test(type)) return null
    return { html: await readCapped(res), finalUrl: current }
  }
  return null
}

/** Read at most MAX_BYTES so a huge page can't balloon the function's memory. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return (await res.text()).slice(0, MAX_BYTES)
  const decoder = new TextDecoder()
  let out = ''
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    out += decoder.decode(value, { stream: true })
    if (total >= MAX_BYTES) {
      await reader.cancel()
      break
    }
  }
  return out
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'",
}

function decodeEntities(s: string): string {
  return s
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      const key = code.toLowerCase()
      if (ENTITIES[key]) return ENTITIES[key]
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16))
      if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)))
      return whole
    })
    .trim()
}

/** Value of <meta property|name="key" content="…"> in either attribute order. */
function metaContent(html: string, key: string): string | null {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*content=["']([^"']*)["']`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${k}["']`,
      'i'
    ),
  ]
  for (const re of patterns) {
    const m = re.exec(html)
    if (m?.[1]) return decodeEntities(m[1])
  }
  return null
}

function titleTag(html: string): string | null {
  const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)
  return m?.[1] ? decodeEntities(m[1].replace(/\s+/g, ' ')) : null
}

/** Walk JSON-LD blocks for the first Product-ish offer price. */
function jsonLdPrice(html: string): { amount: number; currency: string | null } | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )
  for (const block of blocks) {
    let data: unknown
    try {
      data = JSON.parse(block[1]!.trim())
    } catch {
      continue
    }
    const found = findOffer(data)
    if (found) return found
  }
  return null
}

function findOffer(node: unknown, depth = 0): { amount: number; currency: string | null } | null {
  if (!node || typeof node !== 'object' || depth > 6) return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findOffer(child, depth + 1)
      if (hit) return hit
    }
    return null
  }
  const obj = node as Record<string, unknown>
  const price = obj.price ?? obj.lowPrice
  const amount = typeof price === 'string' ? Number(price.replace(/[^0-9.]/g, '')) : price
  if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
    const currency = obj.priceCurrency
    return { amount, currency: typeof currency === 'string' ? currency.toUpperCase() : null }
  }
  for (const value of Object.values(obj)) {
    const hit = findOffer(value, depth + 1)
    if (hit) return hit
  }
  return null
}

/**
 * Shops that render in the browser (Uniqlo among them) publish no price meta
 * tag, but the page they ship still carries the number: either in an embedded
 * JSON blob — "price":1500, "basePrice":{"value":1500} — or as visible yen text.
 * Both are last resorts, applied only when the tags and JSON-LD came up empty.
 */
function embeddedJsonPrice(html: string): { amount: number; currency: string | null } | null {
  // "<price-ish key>": 1500  |  "<price-ish key>": "1,500"
  const re = /"(?:[a-z]*price[a-z]*|amount|value)"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]+)?)"?/gi
  const seen: number[] = []
  for (const m of html.matchAll(re)) {
    const amount = Number(m[1]!.replace(/,/g, ''))
    if (Number.isFinite(amount) && amount >= 100 && amount <= 1_000_000) seen.push(amount)
  }
  if (!seen.length) return null
  // a product page repeats its price (base, display, tax-inc); the most common
  // number is a better guess than the first one it happens to mention
  const counts = new Map<number, number>()
  for (const n of seen) counts.set(n, (counts.get(n) ?? 0) + 1)
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!
  return { amount: best[0], currency: null }
}

/** Visible yen text: "¥1,500" or "1,500円". */
function yenTextPrice(html: string): { amount: number; currency: string | null } | null {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
  const amounts: number[] = []
  for (const m of text.matchAll(/(?:[¥￥]\s*([0-9][0-9,]*)|([0-9][0-9,]*)\s*円)/g)) {
    const raw = m[1] ?? m[2]!
    const amount = Number(raw.replace(/,/g, ''))
    // skip free-shipping thresholds and the like ("¥5,000以上で送料無料")
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12)
    if (/以上|超|送料|off|OFF/.test(after)) continue
    if (Number.isFinite(amount) && amount >= 100 && amount <= 1_000_000) amounts.push(amount)
  }
  if (!amounts.length) return null
  return { amount: amounts[0]!, currency: 'JPY' }
}

/** Shop name: og:site_name if given, else a tidied hostname ("uniqlo.com" → "Uniqlo"). */
function shopName(html: string, url: URL): string | null {
  const site = metaContent(html, 'og:site_name')
  if (site) return site.slice(0, 120)
  const host = url.hostname.replace(/^www\./, '').split('.')[0]
  if (!host) return null
  return host.charAt(0).toUpperCase() + host.slice(1)
}

/**
 * Shop titles pack the brand in beside the product, and the order varies by
 * locale: "Product | UNIQLO" on the English site, "ユニクロ公式 | Product" on the
 * Japanese one. Taking the first segment picks the brand half the time (which
 * is how an import came back named "ユニクロ公式" — "UNIQLO official"), so drop
 * any segment that is just the shop name and keep the most descriptive rest.
 */
function tidyTitle(title: string, shop: string | null): string {
  const segments = title
    .split(/\s*[|｜–—>»·]\s*|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length <= 1) return title.trim().slice(0, 120)

  const shopish = (s: string) => {
    if (!shop) return false
    const a = s.toLowerCase().replace(/\s+/g, '')
    const b = shop.toLowerCase().replace(/\s+/g, '')
    return a === b || a.includes(b) || b.includes(a)
  }
  // "公式" = "official", "オンラインストア"/"online store" — storefront boilerplate
  const boilerplate =
    /^(公式|.*公式(サイト|通販|オンラインストア)?|online ?store|official( site)?|通販|オンラインストア)$/i

  const meaty = segments.filter((s) => !shopish(s) && !boilerplate.test(s))
  const best = (meaty.length ? meaty : segments).reduce((a, b) => (b.length > a.length ? b : a))
  return best.slice(0, 120)
}

export async function previewProductUrl(store: DataStore, rawUrl: string): Promise<ProductPreview> {
  const url = parseUrl(rawUrl)
  if (await resolvesToPrivateAddress(url.hostname))
    throw validation(['that address cannot be fetched'])
  const fetched = await fetchHtml(url)
  if (!fetched) {
    // Reachability is the shop's problem, not a client error — hand back the
    // link so the form can still use it, with nothing else filled in.
    return {
      url: url.toString(),
      name: null,
      image_url: null,
      shop: null,
      price_yen: null,
      price_note: null,
      name_ja: null,
    }
  }
  const { html, finalUrl } = fetched

  const rawName =
    metaContent(html, 'og:title') ??
    metaContent(html, 'twitter:title') ??
    metaContent(html, 'name') ??
    titleTag(html)

  const rawImage =
    metaContent(html, 'og:image:secure_url') ??
    metaContent(html, 'og:image') ??
    metaContent(html, 'twitter:image') ??
    metaContent(html, 'image')

  let image_url: string | null = null
  if (rawImage) {
    try {
      const abs = new URL(rawImage, finalUrl)
      if (abs.protocol === 'http:' || abs.protocol === 'https:') image_url = abs.toString()
    } catch {
      /* unusable image reference — leave it out */
    }
  }

  // price: OG/product meta first, then JSON-LD
  const metaAmount =
    metaContent(html, 'product:price:amount') ??
    metaContent(html, 'og:price:amount') ??
    metaContent(html, 'price')
  const metaCurrency =
    metaContent(html, 'product:price:currency') ??
    metaContent(html, 'og:price:currency') ??
    metaContent(html, 'priceCurrency')
  let price: { amount: number; currency: string | null } | null = null
  if (metaAmount) {
    const amount = Number(metaAmount.replace(/[^0-9.]/g, ''))
    if (Number.isFinite(amount) && amount > 0)
      price = { amount, currency: metaCurrency?.toUpperCase() ?? null }
  }
  price ??= jsonLdPrice(html)
  // shops that price client-side (Uniqlo among them) publish neither
  price ??= embeddedJsonPrice(html)
  price ??= yenTextPrice(html)

  const { price_yen, price_note } = await toYen(store, price)

  const shop = shopName(html, finalUrl)
  const cleaned = rawName ? tidyTitle(rawName, shop) : null
  const { name, name_ja } = await toEnglish(cleaned, finalUrl)

  return {
    url: finalUrl.toString(),
    name,
    image_url,
    shop,
    price_yen,
    price_note,
    name_ja,
  }
}

/**
 * Make the name readable for someone who doesn't read Japanese. Two steps, in
 * order of quality: ask the shop for its own English page (most Japanese chains
 * have one at the same path under /en/), and failing that, translate. The
 * Japanese original comes back too — it's what you point at in the shop.
 */
async function toEnglish(
  name: string | null,
  url: URL
): Promise<{ name: string | null; name_ja: string | null }> {
  if (!name || !containsJapanese(name)) return { name, name_ja: null }

  // /jp/ja/products/… → /jp/en/products/…
  if (/\/ja(\/|$)/.test(url.pathname)) {
    const englishUrl = new URL(url.toString())
    englishUrl.pathname = url.pathname.replace(/\/ja(\/|$)/, '/en$1')
    const englishPage = await fetchHtml(englishUrl)
    if (englishPage) {
      const raw = metaContent(englishPage.html, 'og:title') ?? titleTag(englishPage.html) ?? null
      const shop = shopName(englishPage.html, englishPage.finalUrl)
      const candidate = raw ? tidyTitle(raw, shop) : null
      if (candidate && !containsJapanese(candidate)) return { name: candidate, name_ja: name }
    }
  }

  const translated = await translateJaToEn(name)
  return translated ? { name: translated, name_ja: name } : { name, name_ja: null }
}

/** Convert a found price into yen when we can, else explain why we didn't. */
async function toYen(
  store: DataStore,
  price: { amount: number; currency: string | null } | null
): Promise<{ price_yen: number | null; price_note: string | null }> {
  if (!price) return { price_yen: null, price_note: null }
  const currency = price.currency ?? 'JPY' // a Japanese shop quoting no currency means yen
  if (currency === 'JPY') return { price_yen: Math.round(price.amount), price_note: null }

  try {
    // Quoted from yen, so the rate is "1 JPY in <currency>" and the conversion
    // divides. Any currency the provider quotes works, not just USD/ILS.
    const rates = await getRates(store, 'JPY')
    const perYen = rates.rates[currency.toUpperCase()]
    if (perYen > 0) return { price_yen: Math.round(price.amount / perYen), price_note: null }
  } catch {
    /* no rate available — fall through to the note */
  }
  return {
    price_yen: null,
    price_note: `Listed at ${price.amount} ${currency} — set the yen price yourself.`,
  }
}
