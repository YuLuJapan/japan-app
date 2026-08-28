// What a place looks like to a list, in one place.
//
// The zone's category lists render a `summary_line` the server derives from
// the description. It used to be computed inline while building that list,
// which made it invisible to everything else — including the client, which
// then could not put an edited place back into the list it came from without
// inventing the same rule and hoping the two stayed in step. It is a shared
// function now, and every place the API hands back carries its result.
import type { Category, Place } from './datastore.js'

const SUMMARY_MAX = 100

/** The one-line gist a list shows under a place's name. */
export const summaryLine = (description: string | null | undefined) =>
  description ? description.slice(0, SUMMARY_MAX) : ''

/** A place as any response returns it: its own columns plus what a list needs. */
export const placeView = (place: Place) => ({
  ...place,
  summary_line: summaryLine(place.description),
})

/** On the wire, or not. Two words, because a list has no detail levels. */
export type ListLevel = 'list' | 'omit'

/**
 * How far a column travels into a zone's place list.
 *
 * `'list'` is on the wire; `'omit'` is not. The type is what makes this worth
 * having: `Record<keyof Place, …>` means **adding a column to `Place` is a
 * compile error until someone writes one of the two words next to it** — the
 * pattern `lib/export-view.ts` established in feature 003, applied to the
 * second projection that leaves the server carrying place data.
 *
 * The literal this replaced was explicit and *silent*: a new column left it
 * valid, and the field simply never reached the list — until the next
 * hand-edit quietly added it. `CLAUDE.md` states the rule (anything returning
 * a place gets the `TripView` treatment); this is the form of it a build can
 * check.
 *
 * The guard is only real because `npm run typecheck` runs alongside
 * `npm test`: Vitest transpiles types away, so without that script this table
 * is decoration. `server/tests/map-pins.test.ts` asserts the emitted key set
 * as the weaker, runtime half — it catches a stray spread, not an
 * unclassified column.
 *
 * `summary_line` is derived rather than a column, so it cannot be a
 * `keyof Place`; it is named here anyway, because it is the sanctioned form of
 * the description and someone has to be able to see that it travels.
 */
export const LIST_FIELD_POLICY: Record<keyof Place | 'summary_line', ListLevel> = {
  id: 'list',
  name: 'list',
  name_ja: 'list',
  category: 'list',
  summary_line: 'list',
  address: 'list',
  image_url: 'list',
  lat: 'list',
  lng: 'list',
  // The description is where a booking reference lives. The summary line is
  // the sanctioned form of it, and it is already on the list above.
  description: 'omit',
  // A reservation link is a reservation.
  links: 'omit',
  // The caller asked for this zone; naming it back is a byte per place and no
  // information.
  zone_id: 'omit',
}

const onList = (level: ListLevel) => level === 'list'

/** One row of a zone's place list: the admitted columns, plus the derived line. */
export interface ZonePlaceListItem {
  id: string
  name: string
  name_ja: string | null
  category: Category
  summary_line: string
  image_url: string | null
  address: string | null
  lat: number | null
  lng: number | null
}

/**
 * A place as its zone's list renders it.
 *
 * Assembled field by field against the policy rather than spread from the row,
 * for the same reason `projectExport` is: a spread carries whatever the row
 * grew since anyone last looked.
 */
export function zonePlaceListItem(place: Place): ZonePlaceListItem {
  const out: Partial<ZonePlaceListItem> = {}
  if (onList(LIST_FIELD_POLICY.id)) out.id = place.id
  if (onList(LIST_FIELD_POLICY.name)) out.name = place.name
  if (onList(LIST_FIELD_POLICY.name_ja)) out.name_ja = place.name_ja
  if (onList(LIST_FIELD_POLICY.category)) out.category = place.category
  if (onList(LIST_FIELD_POLICY.summary_line)) out.summary_line = summaryLine(place.description)
  if (onList(LIST_FIELD_POLICY.image_url)) out.image_url = place.image_url ?? null
  if (onList(LIST_FIELD_POLICY.address)) out.address = place.address ?? null
  // Null rather than absent, deliberately: the map counts the places it cannot
  // pin (FR-019), and an absent key and a null value are not equally easy to
  // count honestly (contracts/map.md §1).
  if (onList(LIST_FIELD_POLICY.lat)) out.lat = place.lat ?? null
  if (onList(LIST_FIELD_POLICY.lng)) out.lng = place.lng ?? null
  return out as ZonePlaceListItem
}
