// Japanese → English for product names read off Japanese shop pages (and for
// anything typed in Japanese). Uses MyMemory's free, keyless endpoint, which
// fits the project's $0 constraint.
//
// Best-effort like every other outside call here: no key, no account, and any
// failure returns null so the caller keeps the original text rather than
// blowing up.

// Read per call rather than captured at import — see services/rates.ts.
const endpoint = () => process.env.TRANSLATE_API_URL ?? 'https://api.mymemory.translated.net/get'
const TIMEOUT_MS = 4000
const MAX_CHARS = 300 // product names; keeps us well inside the free daily quota

const cache = new Map<string, string | null>()

/** Kana, kanji or full-width punctuation — text a traveller can't read. */
export function containsJapanese(text: string): boolean {
  return /[぀-ゟ゠-ヿ㐀-䶿一-鿿＀-ﾟ]/.test(text)
}

/** Translate Japanese text to English, or null when we can't. */
export async function translateJaToEn(text: string): Promise<string | null> {
  const q = text.trim().slice(0, MAX_CHARS)
  if (!q || !containsJapanese(q)) return null
  if (cache.has(q)) return cache.get(q) ?? null

  let translated: string | null = null
  try {
    const params = new URLSearchParams({ q, langpair: 'ja|en' })
    const res = await fetch(`${endpoint()}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) {
      const payload = (await res.json()) as {
        responseStatus?: number | string
        responseData?: { translatedText?: string }
      }
      const candidate = payload.responseData?.translatedText?.trim()
      // the API echoes the input (or a quota message) when it can't help
      if (
        candidate &&
        Number(payload.responseStatus) === 200 &&
        candidate.toLowerCase() !== q.toLowerCase() &&
        !containsJapanese(candidate) &&
        !/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(candidate)
      ) {
        translated = candidate
      }
    }
  } catch {
    /* offline, timeout, quota — keep the original */
  }

  cache.set(q, translated)
  return translated
}

/** Test hook: clear the in-memory cache so a test starts from a cold state. */
export function __resetTranslateCache() {
  cache.clear()
}
