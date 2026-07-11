// Day-by-day itinerary: a flat list of activities the client groups by day.
// GET returns every item for the trip; the client maps each day to its city.
import type { DataStore, ItineraryItemInput } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export async function listItinerary(store: DataStore) {
  const trip = await store.getTrip()
  if (!trip) throw notFound('Trip')
  const items = await store.listItinerary(trip.id)
  return { items }
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
  return errors
}

export async function createItineraryItem(store: DataStore, input: ItineraryItemInput) {
  const errors = collectErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await store.getTrip()
  if (!trip) throw notFound('Trip')
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
