// Day-by-day itinerary: a flat list of activities the client groups by day.
// GET returns every item for the trip; the client maps each day to its city.
import type { DataStore, ItineraryItemInput } from '../lib/datastore.js'
import { resolveTrip, type AccessContext } from '../lib/access.js'
import { notFound, validation } from '../lib/errors.js'
import { STAY_CATEGORY } from '../lib/guest-view.js'
import { collectRangeErrors } from '../lib/trip-dates.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * `includeStays: false` is the guest view: the day-by-day plan still shows
 * "check in at the ryokan", but the link to the stay is cut off the item —
 * that page is refused for guests (lib/guest-view.ts), so leaving `place_id`
 * on would only render a link into a 403.
 */
export async function listItinerary(
  store: DataStore,
  access: AccessContext,
  tripId: string,
  { includeStays = true }: { includeStays?: boolean } = {}
) {
  const trip = await resolveTrip(store, access, tripId)
  const items = await store.listItinerary(trip.id)
  if (includeStays) return { items }
  const stayIds = new Set(await store.listPlaceIdsByCategory(STAY_CATEGORY))
  return {
    items: items.map((item) =>
      item.place_id && stayIds.has(item.place_id) ? { ...item, place_id: null } : item
    ),
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
  access: AccessContext,
  input: ItineraryItemInput,
  tripId: string
) {
  const errors = collectErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await resolveTrip(store, access, tripId)
  // An activity only exists on a day the trip actually covers.
  const rangeErrors = collectRangeErrors('day', input.day, trip)
  if (rangeErrors.length) throw validation(rangeErrors)
  if (input.zone_id) {
    const zone = await store.getZone(input.zone_id)
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
  itemId: string,
  patch: Partial<ItineraryItemInput>
) {
  const errors = collectErrors(patch, true)
  if (errors.length) throw validation(errors)
  if (patch.day !== undefined) {
    const existing = await store.getItineraryItem(itemId)
    if (!existing) throw notFound('Itinerary item')
    const trip = await store.getTrip(existing.trip_id)
    if (!trip) throw notFound('Trip')
    const rangeErrors = collectRangeErrors('day', patch.day, trip)
    if (rangeErrors.length) throw validation(rangeErrors)
  }
  if (patch.zone_id) {
    const zone = await store.getZone(patch.zone_id)
    if (!zone) throw notFound('Zone')
  }
  const clean: Partial<ItineraryItemInput> = { ...patch }
  if (clean.title !== undefined) clean.title = clean.title.trim()
  if (clean.start_time !== undefined) clean.start_time = clean.start_time || null
  const item = await store.updateItineraryItem(itemId, clean)
  if (!item) throw notFound('Itinerary item')
  return { item }
}

export async function deleteItineraryItem(store: DataStore, itemId: string) {
  const ok = await store.deleteItineraryItem(itemId)
  if (!ok) throw notFound('Itinerary item')
}
