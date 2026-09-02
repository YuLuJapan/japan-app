// Activities: one entity for everything on a trip that is somewhere to go,
// something to do, or a line on a day (feature 010).
//
// This is `services/places.ts` and `services/itinerary.ts` merged, and the
// merge is mostly deletion: the two collected almost the same validation
// errors against almost the same fields, and differed only in which half of
// the row they refused to carry.
//
// **The date is the only thing that decides where an activity shows.** With a
// `day` it is on the day plan; without one it is in its city's Explore list.
// Setting or clearing that date is an ordinary PATCH — it is what "Schedule
// this" and "Unschedule" send — and it is the one write in the app that moves
// a row from one list to another.
import type { Activity, ActivityInput, DataStore, PlaceLink } from '../lib/datastore.js'
import { CATEGORIES } from '../lib/datastore.js'
import { requireTrip } from '../lib/access.js'
import { forbidden, notFound, validation } from '../lib/errors.js'
import { activityView, type ActivityViewRow } from '../lib/activity-view.js'
import { isStay, stripStay } from '../lib/trip-view.js'
import { collectRangeErrors } from '../lib/trip-dates.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const isHttpUrl = (u: string) => /^https?:\/\/.+/.test(u)

/**
 * One activity as any list renders it, plus what only the detail screen needs.
 *
 * `files` is the shape the old place detail returned; it is now available on a
 * scheduled activity too, which is the capability this feature exists to add.
 */
export interface ActivityDetail {
  activity: ActivityViewRow
  tips: { id: string; zone_id: string | null; activity_id: string | null; body: string }[]
  files: { id: string; display_name: string; mime_type: string; size_bytes: number }[]
}

/**
 * `includeFiles: false` withholds attachments — they never leave the server.
 * `includeStays: false` is the same view's other half, and it splits by date:
 * a **saved** stay is the booking itself, so the page is refused outright
 * (FR-020); a **scheduled** one is a line on the day plan, so it keeps its row
 * and loses its content (FR-021).
 */
export async function getActivityDetail(
  store: DataStore,
  tripId: string,
  activityId: string,
  {
    includeFiles = true,
    includeStays = true,
  }: { includeFiles?: boolean; includeStays?: boolean } = {}
): Promise<ActivityDetail> {
  // The store answers "not in this trip" and "no such activity" identically,
  // so an outsider cannot tell the two apart.
  const activity = await store.getActivity(tripId, activityId)
  if (!activity) throw notFound('Activity')
  const withheld = !includeStays && isStay(activity)
  if (withheld && activity.day === null) {
    throw forbidden('Where this trip is staying is not shared with you')
  }
  // A withheld *scheduled* stay keeps its line and loses everything else — its
  // tips and files included, which is why they are not fetched at all.
  const [tips, files] = withheld
    ? [[], []]
    : await Promise.all([
        store.listTips(tripId, { activity_id: activityId }),
        includeFiles ? store.listFiles(tripId, { activity_id: activityId }) : [],
      ])
  return {
    activity: activityView(withheld ? stripStay(activity) : activity),
    tips,
    files: files.map(({ id, display_name, mime_type, size_bytes }) => ({
      id,
      display_name,
      mime_type,
      size_bytes,
    })),
  }
}

/**
 * Every activity on the trip — the one list every screen filters.
 *
 * The day plan takes the dated ones, a city's Explore takes the undated ones
 * in that city, the map takes the located ones. One read, because there is one
 * table; the filtering is the client's, and doing it here would mean four
 * endpoints returning subsets of the same rows.
 *
 * `place_files` from the pre-010 day plan is gone as a *derived* field: an
 * activity's files are its own now, so the list carries a count and the detail
 * screen carries the names. A caller who may not see documents gets zero,
 * which is the same rule as before.
 */
export async function listActivities(
  store: DataStore,
  tripId: string,
  {
    includeStays = true,
    includeDocuments = true,
  }: { includeStays?: boolean; includeDocuments?: boolean } = {}
): Promise<{ activities: ActivityViewRow[] }> {
  const trip = await requireTrip(store, tripId)
  const rows = await store.listActivities(trip.id)

  // FR-020 / FR-021: a saved stay disappears; a scheduled one is emptied. The
  // two differ because a plan line is not the reservation — dropping it would
  // leave a hole in the day that says something was there.
  const visible = includeStays
    ? rows
    : rows.filter((a) => !(isStay(a) && a.day === null)).map((a) => (isStay(a) ? stripStay(a) : a))

  const fileCounts = new Map<string, number>()
  if (includeDocuments) {
    for (const file of await store.listAllFiles(trip.id)) {
      if (!file.activity_id) continue
      fileCounts.set(file.activity_id, (fileCounts.get(file.activity_id) ?? 0) + 1)
    }
  }
  return {
    activities: visible.map((a) => activityView(a, fileCounts.get(a.id) ?? 0)),
  }
}

function collectActivityErrors(input: Partial<ActivityInput>, partial: boolean): string[] {
  const errors: string[] = []
  const has = (k: keyof ActivityInput) => input[k] !== undefined

  if (!partial || has('name')) {
    const name = (input.name ?? '').trim()
    if (!name) errors.push('name is required')
    else if (name.length > 200) errors.push('name must be at most 200 characters')
  }
  // A tag is optional — 135 plan lines in production have none, and stamping
  // them would put a pill on rows nobody asked to label. Any of the five is
  // allowed on any activity, dated or not: `other` renders as "More" on the
  // day plan exactly as it does in Explore (`CATEGORY_META` carries a look for
  // it), so there is nothing left for the date to decide.
  if (has('category') && input.category != null && !CATEGORIES.includes(input.category)) {
    errors.push(`category must be one of: ${CATEGORIES.join(', ')}`)
  }
  if (has('day') && input.day != null && input.day !== '' && !DATE_RE.test(input.day)) {
    errors.push('day must be an ISO date (YYYY-MM-DD)')
  }
  if (has('start_time') && input.start_time != null && input.start_time !== '') {
    if (!TIME_RE.test(input.start_time)) errors.push('start_time must be HH:MM (24h)')
  }
  if (has('links') && input.links != null) {
    if (!Array.isArray(input.links)) errors.push('links must be an array')
    else {
      for (const link of input.links as PlaceLink[]) {
        if (!link?.label?.trim()) errors.push('every link needs a label')
        if (!link?.url || !isHttpUrl(link.url))
          errors.push('every link url must start with http(s)://')
      }
    }
  }
  if (has('description') && (input.description ?? '').length > 5000)
    errors.push('description must be at most 5000 characters')
  if (
    has('image_url') &&
    input.image_url != null &&
    input.image_url !== '' &&
    !isHttpUrl(input.image_url)
  )
    errors.push('image_url must start with http(s)://')
  if (
    has('lat') &&
    input.lat != null &&
    (typeof input.lat !== 'number' || input.lat < -90 || input.lat > 90)
  )
    errors.push('lat must be a number between -90 and 90')
  if (
    has('lng') &&
    input.lng != null &&
    (typeof input.lng !== 'number' || input.lng < -180 || input.lng > 180)
  )
    errors.push('lng must be a number between -180 and 180')
  if (has('icon') && input.icon != null && [...input.icon].length > 8)
    errors.push('icon must be at most 8 characters')
  return errors
}

/**
 * The two rules that depend on the *pair* of `day` and the rest of the row,
 * checked against what the activity will look like after the write rather than
 * against the patch — a PATCH clearing `day` on a city-less row has to be
 * refused even though neither field is wrong on its own.
 */
function collectShapeErrors(next: Pick<Activity, 'day' | 'zone_id' | 'highlight'>) {
  const errors: string[] = []
  // FR-004. A service rule rather than a check constraint: as a constraint it
  // would abort trip deletion (specs/010-activities/migration.md §2).
  if (next.day === null && next.zone_id === null) {
    errors.push('an activity with no date needs a city — it is saved to a city’s Explore list')
  }
  // FR-005: a featured note banners a day, so it needs one.
  if (next.highlight && next.day === null) {
    errors.push('a featured note needs a date — it banners one day of the trip')
  }
  return errors
}

export async function createActivity(store: DataStore, tripId: string, input: ActivityInput) {
  const errors = collectActivityErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await requireTrip(store, tripId)
  const day = input.day || null
  // An activity only exists on a day the trip actually covers — but an undated
  // one has no day to check, which is the whole point of it.
  if (day) {
    const rangeErrors = collectRangeErrors('day', day, trip)
    if (rangeErrors.length) throw validation(rangeErrors)
  }
  const shapeErrors = collectShapeErrors({
    day,
    zone_id: input.zone_id ?? null,
    highlight: input.highlight ?? false,
  })
  if (shapeErrors.length) throw validation(shapeErrors)
  if (input.zone_id) {
    const zone = await store.getZone(trip.id, input.zone_id)
    if (!zone) throw notFound('Zone')
  }
  const activity = await store.createActivity({
    ...input,
    trip_id: trip.id,
    name: input.name.trim(),
    day,
    start_time: input.start_time || null,
  })
  return { activity: activityView(activity) }
}

export async function updateActivity(
  store: DataStore,
  tripId: string,
  activityId: string,
  patch: Partial<ActivityInput>
) {
  const errors = collectActivityErrors(patch, true)
  if (errors.length) throw validation(errors)
  const existing = await store.getActivity(tripId, activityId)
  if (!existing) throw notFound('Activity')

  const day = patch.day !== undefined ? patch.day || null : existing.day
  if (patch.day !== undefined && day) {
    const trip = await store.getTrip(existing.trip_id)
    if (!trip) throw notFound('Trip')
    const rangeErrors = collectRangeErrors('day', day, trip)
    if (rangeErrors.length) throw validation(rangeErrors)
  }
  // Checked against the row as it will be, not as the patch reads: clearing a
  // date on a city-less activity is two valid fields making an invalid row.
  const shapeErrors = collectShapeErrors({
    day,
    zone_id: patch.zone_id !== undefined ? (patch.zone_id ?? null) : existing.zone_id,
    highlight: patch.highlight !== undefined ? (patch.highlight ?? false) : existing.highlight,
  })
  if (shapeErrors.length) throw validation(shapeErrors)
  if (patch.zone_id) {
    // Both ends have to be in this trip, or an activity could be moved into
    // someone else's city. The store enforces it too; this is what turns that
    // into a 404 rather than a silent no-op.
    const zone = await store.getZone(tripId, patch.zone_id)
    if (!zone) throw notFound('Zone')
  }
  const clean: Partial<ActivityInput> = { ...patch }
  if (clean.name !== undefined) clean.name = clean.name.trim()
  if (clean.day !== undefined) clean.day = day
  if (clean.start_time !== undefined) clean.start_time = clean.start_time || null
  const activity = await store.updateActivity(tripId, activityId, clean)
  if (!activity) throw notFound('Activity')
  return { activity: activityView(activity) }
}

export async function deleteActivity(store: DataStore, tripId: string, activityId: string) {
  const activity = await store.getActivity(tripId, activityId)
  if (!activity) throw notFound('Activity')
  // No silent file loss (data-model.md): move the activity's files to the trip
  // first. That trip is the one in the path, so an activity deleted from one
  // trip cannot dump its files on another.
  await store.reparentFilesToTrip(activityId, tripId)
  await store.deleteActivity(tripId, activityId)
}
