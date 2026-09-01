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

/**
 * An activity as any response returns it: its own columns, plus the one-line
 * gist a list shows and how many documents it holds.
 *
 * `file_count` rather than the names: a name is a document (the `documents`
 * view withholds them), and the detail screen is where the names belong. It is
 * the merged replacement for the pre-010 day plan's derived `place_files`.
 */
export const activityView = (activity: Activity, fileCount = 0): ActivityViewRow => ({
  ...activity,
  summary_line: summaryLine(activity.description),
  file_count: fileCount,
})

export type ActivityViewRow = Activity & { summary_line: string; file_count: number }

/** On the wire, or not. Two words, because a list has no detail levels. */
export type ListLevel = 'list' | 'omit'

/**
 * How far a column travels into a zone's place list.
 *
 * `'list'` is on the wire; `'omit'` is not. The type is what makes this worth
 * having: `Record<keyof Activity, …>` means **adding a column to `Activity` is a
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
    // What decides which list this row is on at all, so every list needs it.
    day: 'list',
    start_time: 'list',
    position: 'list',
    highlight: 'list',
    icon: 'list',
    // A count, not the names: a document's name is a document.
    file_count: 'list',
    // The description is where a booking reference lives. The summary line is
    // the sanctioned form of it, and it is already on the list above.
    description: 'omit',
    // A reservation link is a reservation.
    links: 'omit',
    // The one list that reads this is scoped to a city already — but the trip
    // screen's day plan is not, and bands a moving day by city, so it travels.
    zone_id: 'list',
    // The caller asked for this trip.
    trip_id: 'omit',
  }

const onList = (level: ListLevel) => level === 'list'

/** One row of an activity list: the admitted columns, plus the derived ones. */
export interface ActivityListItem {
  id: string
  name: string
  name_ja: string | null
  category: Category | null
  summary_line: string
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
 * A place as its zone's list renders it.
 *
 * Assembled field by field against the policy rather than spread from the row,
 * for the same reason `projectExport` is: a spread carries whatever the row
 * grew since anyone last looked.
 */
export function activityListItem(activity: Activity, fileCount = 0): ActivityListItem {
  const out: Partial<ActivityListItem> = {}
  if (onList(LIST_FIELD_POLICY.id)) out.id = activity.id
  if (onList(LIST_FIELD_POLICY.name)) out.name = activity.name
  if (onList(LIST_FIELD_POLICY.name_ja)) out.name_ja = activity.name_ja
  if (onList(LIST_FIELD_POLICY.category)) out.category = activity.category
  if (onList(LIST_FIELD_POLICY.summary_line)) out.summary_line = summaryLine(activity.description)
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
  return out as ActivityListItem
}
