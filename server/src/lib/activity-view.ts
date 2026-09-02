// What a place looks like to a list, in one place.
//
// The zone's category lists render a `summary_line` the server derives from
// the description. It used to be computed inline while building that list,
// which made it invisible to everything else — including the client, which
// then could not put an edited place back into the list it came from without
// inventing the same rule and hoping the two stayed in step. It is a shared
// function now, and every place the API hands back carries its result.
import type { Activity, Category } from './datastore.js'

const SUMMARY_MAX = 100

/** The one-line gist a list shows under a place's name. */
export const summaryLine = (description: string | null | undefined) =>
  description ? description.slice(0, SUMMARY_MAX) : ''

/** On the wire, or not. Two words, because a list has no detail levels. */
export type ListLevel = 'list' | 'omit'

/**
 * How far a column travels into an API response.
 *
 * The type is what makes this worth having: `Record<keyof Activity, …>` means
 * **adding a column to `Activity` is a compile error until someone writes one
 * of the two words next to it** — the pattern `lib/export-view.ts` established
 * in feature 003.
 *
 * **010 changed what `description` and `links` are classified as, and the
 * reason is worth writing down.** Before the merge, a zone's place list omitted
 * both: the list was built for browsing and a stay's description is the
 * booking, so not shipping it to a screen that would not render it was cheap
 * defence in depth. After the merge the same column is also the note under a
 * day-plan line, which that screen does render — and one column cannot be both
 * carried and withheld.
 *
 * So the guarantee moved rather than weakened: what keeps a booking away from
 * someone who may not see it is `stripStay` in `lib/trip-view.ts` (FR-020 /
 * FR-021), applied **before** this projection, which is the order the export
 * has always used and the one the whole feature depends on. Trimming the field
 * here would have hidden a stay's description from the person it belongs to as
 * well, on the one screen that shows it.
 *
 * The guard is only real because `npm run typecheck` runs alongside `npm test`:
 * Vitest transpiles types away, so without that script this table is
 * decoration. `server/tests/map-pins.test.ts` asserts the emitted key set as
 * the weaker, runtime half — it catches a stray spread, not an unclassified
 * column.
 */
export const LIST_FIELD_POLICY: Record<keyof Activity | 'summary_line' | 'file_count', ListLevel> =
  {
    id: 'list',
    name: 'list',
    name_ja: 'list',
    category: 'list',
    summary_line: 'list',
    address: 'list',
    image_url: 'list',
    lat: 'list',
    lng: 'list',
    // What decides which list a row is on at all.
    day: 'list',
    start_time: 'list',
    position: 'list',
    highlight: 'list',
    icon: 'list',
    // The note a day-plan line renders. See the note above on why this travels
    // now when a place's description did not.
    description: 'list',
    links: 'list',
    // A count, not the names: a document's name is a document.
    file_count: 'list',
    // The trip screen bands a moving day by city, so this travels.
    zone_id: 'list',
    // The caller asked for this trip.
    trip_id: 'omit',
  }

const onList = (level: ListLevel) => level === 'list'

/** One row of an activity list: the admitted columns, plus the derived ones. */
export interface ActivityViewRow {
  id: string
  name: string
  name_ja: string | null
  category: Category | null
  summary_line: string
  description: string | null
  links: Activity['links']
  image_url: string | null
  address: string | null
  lat: number | null
  lng: number | null
  zone_id: string | null
  day: string | null
  start_time: string | null
  position: number
  highlight: boolean
  icon: string | null
  file_count: number
}

/**
 * An activity as **every** response returns it — the list and the detail alike.
 *
 * Assembled field by field against the policy rather than spread from the row,
 * for the same reason `projectExport` is: a spread carries whatever the row has
 * grown since anyone last looked.
 *
 * `fileCount` has no default, deliberately. It is the one field here that
 * cannot be read off the row — nothing stores it, it is counted per request —
 * and a default made "nobody counted" indistinguishable from "no files": every
 * single-activity response answered `0`, so an edit merged back into the day
 * plan took the 📎 off an activity that still had its documents. A caller who
 * decides the count is `0` now has to say so.
 */
export function activityView(activity: Activity, fileCount: number): ActivityViewRow {
  const out: Partial<ActivityViewRow> = {}
  if (onList(LIST_FIELD_POLICY.id)) out.id = activity.id
  if (onList(LIST_FIELD_POLICY.name)) out.name = activity.name
  if (onList(LIST_FIELD_POLICY.name_ja)) out.name_ja = activity.name_ja
  if (onList(LIST_FIELD_POLICY.category)) out.category = activity.category
  if (onList(LIST_FIELD_POLICY.summary_line)) out.summary_line = summaryLine(activity.description)
  if (onList(LIST_FIELD_POLICY.description)) out.description = activity.description
  if (onList(LIST_FIELD_POLICY.links)) out.links = activity.links
  if (onList(LIST_FIELD_POLICY.image_url)) out.image_url = activity.image_url ?? null
  if (onList(LIST_FIELD_POLICY.address)) out.address = activity.address ?? null
  // Null rather than absent, deliberately: the map counts the activities it
  // cannot pin (FR-019), and an absent key and a null value are not equally
  // easy to count honestly (contracts/map.md §1).
  if (onList(LIST_FIELD_POLICY.lat)) out.lat = activity.lat ?? null
  if (onList(LIST_FIELD_POLICY.lng)) out.lng = activity.lng ?? null
  if (onList(LIST_FIELD_POLICY.zone_id)) out.zone_id = activity.zone_id
  if (onList(LIST_FIELD_POLICY.day)) out.day = activity.day
  if (onList(LIST_FIELD_POLICY.start_time)) out.start_time = activity.start_time
  if (onList(LIST_FIELD_POLICY.position)) out.position = activity.position
  if (onList(LIST_FIELD_POLICY.highlight)) out.highlight = activity.highlight
  if (onList(LIST_FIELD_POLICY.icon)) out.icon = activity.icon
  if (onList(LIST_FIELD_POLICY.file_count)) out.file_count = fileCount
  return out as ActivityViewRow
}
