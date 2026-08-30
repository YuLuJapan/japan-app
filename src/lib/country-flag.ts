// A country's flag, from its code.
//
// The two letters of an ISO 3166-1 alpha-2 code map onto the two regional
// indicator symbols that render as that country's flag — so 243 flags cost two
// lines and no assets, and a country added to the list arrives with its flag
// already drawn.
//
// Known gap, accepted rather than discovered later: Windows ships no flag
// glyphs, so the pair renders as the letters "JP". The app is mobile-first and
// both phone platforms draw them properly; the name is always shown beside the
// flag, so nothing is lost where the glyph is not.

/** The first regional indicator, 🇦, sits this far above 'A'. */
const REGIONAL_INDICATOR_A = 0x1f1e6
const LETTER_A = 'A'.charCodeAt(0)

/**
 * The flag for a two-letter country code, or the code itself for anything else.
 *
 * The fallback matters: this runs on whatever a trip happens to carry, and a
 * row hand-edited into holding something other than a code should render as
 * that oddity rather than as an empty box or a pair of unrelated symbols.
 */
export function flagFor(code: string | null | undefined): string {
  if (!code) return ''
  const value = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(value)) return code
  return String.fromCodePoint(
    ...[...value].map((letter) => letter.charCodeAt(0) - LETTER_A + REGIONAL_INDICATOR_A)
  )
}
