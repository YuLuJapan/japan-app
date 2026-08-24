// Essentials carries two kinds of content: advice that travels (passports,
// eSIMs) and advice that only makes sense in Japan (Visit Japan Web, Suica,
// Takkyubin, the emergency numbers). Which half a trip gets is decided here.
//
// `country` is free text typed on the trip sheet, not a code, so it is matched
// loosely and as a whole word — "Japan", "japan ", and "Japan & Korea" are all
// trips to Japan, "Jordan" is not.

const JAPAN_WORD = /(^|[^\p{L}])(japan|nippon|nihon)([^\p{L}]|$)/iu
const JAPAN_EXACT = new Set(['jp', 'jpn', '日本'])

/**
 * True when the trip's country names Japan. An unknown country — the bundle
 * still loading, or nobody filled it in — is not Japan: a thinner page beats
 * yen advice on a trip to Lisbon.
 */
export function isJapanTrip(country: string | null | undefined): boolean {
  if (!country) return false
  const value = country.trim().toLowerCase()
  return JAPAN_EXACT.has(value) || JAPAN_WORD.test(value)
}
