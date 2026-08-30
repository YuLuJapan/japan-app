// Matching what someone typed against the country list, on the device.
//
// The list itself is served (`GET /api/countries`, from server/src/lib/
// countries.ts) — this is only the rule for deciding whether a string names one
// of its entries, which the form needs on every keystroke and cannot ask the
// server about that often.
//
// The rule is deliberately the same three lines the server uses, and just as
// deliberately not the guard: the server validates every write regardless, so
// the worst a wrong answer here can do is show a message that a save would have
// shown anyway.

import type { Country } from '../api/types'

/**
 * The country a string names, or undefined.
 *
 * Trimmed, case-insensitive, matching the name or one of its aliases — and
 * exact otherwise. Never fuzzy: "Jappan" is refused rather than corrected to
 * Japan, because guessing is how the wrong country gets stored confidently.
 */
export function matchCountry(
  countries: Country[] | undefined,
  text: string | null | undefined
): Country | undefined {
  if (!countries || !text) return undefined
  const value = text.trim().toLowerCase()
  if (!value) return undefined
  return countries.find(
    (c) =>
      c.name.toLowerCase() === value || (c.aliases ?? []).some((a) => a.toLowerCase() === value)
  )
}
