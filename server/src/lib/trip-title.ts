// What a trip is called.
//
// `name` is an override, not the title. Left empty, the app builds one from
// who is going and where — "Yuval and Luciana in Japan" — so creating a trip
// is one less thing to think of.
//
// Pure, and computed server-side. The result travels as `display_title` on
// every trip payload, which means one implementation rather than one per
// client drifting from the others.
import type { Traveller } from './datastore.js'

/** Beyond this many names the list stops being a title and starts being a list. */
const MAX_NAMES = 3

/**
 * "Alex" · "Alex and Sam" · "Alex, Sam and Jo" · "Alex, Sam and 2 others".
 *
 * The Oxford comma is deliberately absent: this is a title, not prose.
 */
export function formatNames(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean)
  if (!clean.length) return ''
  if (clean.length === 1) return clean[0]
  if (clean.length <= MAX_NAMES) {
    return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`
  }
  const shown = clean.slice(0, MAX_NAMES - 1)
  const rest = clean.length - shown.length
  return `${shown.join(', ')} and ${rest} others`
}

export interface TitleSource {
  name?: string | null
  country?: string | null
  people?: Traveller[]
  /**
   * Display names of the trip's members, used only when nobody is listed under
   * `people`. The roster is the deliberate answer to "who is going"; membership
   * is who can open the app, and may include a friend it was shared with —
   * who has no business appearing in the title.
   */
  memberNames?: string[]
}

export function displayTitle(trip: TitleSource): string {
  const name = (trip.name ?? '').trim()
  if (name) return name

  const country = (trip.country ?? '').trim()
  const listed = (trip.people ?? []).map((p) => p.name)
  const names = formatNames(listed.some((n) => n.trim()) ? listed : (trip.memberNames ?? []))

  if (names && country) return `${names} in ${country}`
  if (country) return `Trip to ${country}`
  if (names) return `${names}’s trip`
  return 'Untitled trip'
}
