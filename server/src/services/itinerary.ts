// Day-by-day itinerary: a flat list of activities the client groups by day.
// GET returns every item for the trip; the client maps each day to its city.
import type { Category, DataStore, ItineraryItem, ItineraryItemInput } from '../lib/datastore.js'
import { requireTrip } from '../lib/access.js'
import { notFound, validation } from '../lib/errors.js'
import { STAY_CATEGORY } from '../lib/trip-view.js'
import { collectRangeErrors } from '../lib/trip-dates.js'

/**
 * An activity as the day plan renders it: the stored row plus the two things
 * the redesign's plan tags say about the place it links to (option 1g).
 *
 * These are derived per request, never stored — which is deliberate. The
 * export's field policy is keyed on `keyof ItineraryItem`, so a *stored*
 * column could not be added without classifying it; a view field is the
 * `place-view.ts` / `step-view.ts` pattern instead, and keeps the export
 * projecting the row it already knows how to classify.
 */
export interface ItineraryItemView extends ItineraryItem {
  /**
   * Category of the linked place, for the coloured tag under the title. Null
   * when the item links to nothing — and when it links to a stay this caller
   * may not see, since `place_id` is already cut off those and the category
   * would put the fact of the stay straight back on the screen.
   */
  place_category: Category | null
  /**
   * Display names of the files attached to the linked place ("Entry
   * ticket.pdf"). Always empty for a caller who may not see documents.
   */
  place_files: string[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * `includeStays: false` is a view without the stays: the day-by-day plan still shows
 * "check in at the ryokan", but the link to the stay is cut off the item —
 * that page is refused for them (lib/trip-view.ts), so leaving `place_id`
 * on would only render a link into a 403. The tags below follow `place_id`
 * rather than being filtered separately: an item whose link has been cut has
 * nothing left to look up, so a withheld stay cannot leak its category or the
 * name of a file attached to it.
 *
 * The two lookup sweeps only happen when some item actually links to a place,
 * so a trip whose plan is all free text still costs exactly one query — this
 * is the trip screen's endpoint, and it is read far more often than anything
 * else in the app.
 */
export async function listItinerary(
  store: DataStore,
  tripId: string,
  {
    includeStays = true,
    includeDocuments = true,
  }: { includeStays?: boolean; includeDocuments?: boolean } = {}
): Promise<{ items: ItineraryItemView[] }> {
  const trip = await requireTrip(store, tripId)
  const rows = await store.listItinerary(trip.id)

  const stayIds = includeStays
    ? null
    : new Set(await store.listPlaceIdsByCategory(trip.id, STAY_CATEGORY))
  const visible = rows.map((item) =>
    item.place_id && stayIds?.has(item.place_id) ? { ...item, place_id: null } : item
  )

  const linked = visible.some((item) => item.place_id)
  if (!linked) {
    return { items: visible.map((item) => ({ ...item, place_category: null, place_files: [] })) }
  }

  const categoryOf = new Map(
    (await store.listAllPlaces(trip.id)).map((place) => [place.id, place.category])
  )
  const filesOf = new Map<string, string[]>()
  if (includeDocuments) {
    for (const file of await store.listAllFiles(trip.id)) {
      if (!file.place_id) continue
      const names = filesOf.get(file.place_id)
      if (names) names.push(file.display_name)
      else filesOf.set(file.place_id, [file.display_name])
    }
  }

  return {
    items: visible.map((item) => ({
      ...item,
      place_category: (item.place_id && categoryOf.get(item.place_id)) || null,
      place_files: (item.place_id && filesOf.get(item.place_id)) || [],
    })),
  }
}

function collectErrors(input: Partial<ItineraryItemInput>, partial: boolean): string[] {
  const errors: string[] = []
  const has = (k: keyof ItineraryItemInput) => input[k] !== undefined

  if (!partial || has('title')) {
    const title = (input.title ?? '').trim()
    if (!title) errors.push('title is required')
    else if (title.length > 200) errors.push('title must be at most 200 characters')
  }
  if (!partial || has('day')) {
    if (!input.day || !DATE_RE.test(input.day)) errors.push('day must be an ISO date (YYYY-MM-DD)')
  }
  if (has('start_time') && input.start_time != null && input.start_time !== '') {
    if (!TIME_RE.test(input.start_time)) errors.push('start_time must be HH:MM (24h)')
  }
  if (has('note') && (input.note ?? '').length > 1000)
    errors.push('note must be at most 1000 characters')
  if (has('icon') && input.icon != null && [...input.icon].length > 8)
    errors.push('icon must be at most 8 characters')
  return errors
}

export async function createItineraryItem(
  store: DataStore,
  tripId: string,
  input: ItineraryItemInput
) {
  const errors = collectErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await requireTrip(store, tripId)
  // An activity only exists on a day the trip actually covers.
  const rangeErrors = collectRangeErrors('day', input.day, trip)
  if (rangeErrors.length) throw validation(rangeErrors)
  if (input.zone_id) {
    const zone = await store.getZone(trip.id, input.zone_id)
    if (!zone) throw notFound('Zone')
  }
  const item = await store.createItineraryItem({
    ...input,
    trip_id: trip.id,
    title: input.title.trim(),
    start_time: input.start_time || null,
  })
  return { item }
}

export async function updateItineraryItem(
  store: DataStore,
  tripId: string,
  itemId: string,
  patch: Partial<ItineraryItemInput>
) {
  const errors = collectErrors(patch, true)
  if (errors.length) throw validation(errors)
  if (patch.day !== undefined) {
    const existing = await store.getItineraryItem(tripId, itemId)
    if (!existing) throw notFound('Itinerary item')
    const trip = await store.getTrip(existing.trip_id)
    if (!trip) throw notFound('Trip')
    const rangeErrors = collectRangeErrors('day', patch.day, trip)
    if (rangeErrors.length) throw validation(rangeErrors)
  }
  if (patch.zone_id) {
    const zone = await store.getZone(tripId, patch.zone_id)
    if (!zone) throw notFound('Zone')
  }
  const clean: Partial<ItineraryItemInput> = { ...patch }
  if (clean.title !== undefined) clean.title = clean.title.trim()
  if (clean.start_time !== undefined) clean.start_time = clean.start_time || null
  const item = await store.updateItineraryItem(tripId, itemId, clean)
  if (!item) throw notFound('Itinerary item')
  return { item }
}

export async function deleteItineraryItem(store: DataStore, tripId: string, itemId: string) {
  const ok = await store.deleteItineraryItem(tripId, itemId)
  if (!ok) throw notFound('Itinerary item')
}
