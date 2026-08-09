// Trips: the top-level "which journey is this" entity. GET /api/trips lists
// them all (the "Where to next?" screen); GET /api/trips/:tripId returns the
// full journey skeleton for one (steps + zones + flight + file count).
import type { DataStore, ItineraryItem, JourneyStep, Trip, TripInput } from '../lib/datastore.js'
import { getDefaultTrip, normalizeTraveller } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'
import { FLIGHT } from '../lib/flight.js'
import type { DateRange } from '../lib/trip-dates.js'
import { rangeLabel, withinRange } from '../lib/trip-dates.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_MAX = 120
const PERSON_MAX = 60
const PEOPLE_MAX = 12

export async function listTrips(store: DataStore) {
  return { trips: await store.listTrips() }
}

export async function getTripBundle(store: DataStore, tripId: string) {
  const trip = await store.getTrip(tripId)
  if (!trip) throw notFound('Trip')
  const steps = await store.listSteps(trip.id)
  const stepsWithZones = await Promise.all(
    steps.map(async (step) => {
      const zone = await store.getZone(step.zone_id)
      const place_counts = await store.countPlacesByCategory(step.zone_id)
      return {
        id: step.id,
        position: step.position,
        start_date: step.start_date,
        end_date: step.end_date,
        zone: zone ? { ...zone, place_counts } : null,
      }
    })
  )
  const trip_files_count = await store.countTripFiles(trip.id)
  return { trip, steps: stepsWithZones, trip_files_count, flight: FLIGHT }
}

/** Legacy GET /api/trip: whichever trip is oldest, kept for the pre-multi-trip UI. */
export async function getDefaultTripBundle(store: DataStore) {
  const trip = await getDefaultTrip(store)
  if (!trip) throw notFound('Trip')
  return getTripBundle(store, trip.id)
}

function cleanPeople(people: unknown[] | undefined) {
  if (people === undefined) return undefined
  return people
    .map(normalizeTraveller)
    .map((p) => ({ name: p.name.trim(), ...(p.email ? { email: p.email.trim() } : {}) }))
    .filter((p) => p.name)
}

function collectTripErrors(input: Partial<TripInput>, partial: boolean): string[] {
  const errors: string[] = []
  const has = (k: keyof TripInput) => input[k] !== undefined

  if (!partial || has('name')) {
    const name = (input.name ?? '').trim()
    if (!name) errors.push('name is required')
    else if (name.length > NAME_MAX) errors.push(`name must be at most ${NAME_MAX} characters`)
  }
  if (!partial || has('start_date')) {
    if (!input.start_date || !DATE_RE.test(input.start_date))
      errors.push('start_date must be an ISO date (YYYY-MM-DD)')
  }
  if (!partial || has('end_date')) {
    if (!input.end_date || !DATE_RE.test(input.end_date))
      errors.push('end_date must be an ISO date (YYYY-MM-DD)')
  }
  if (
    input.start_date &&
    input.end_date &&
    DATE_RE.test(input.start_date) &&
    DATE_RE.test(input.end_date) &&
    input.end_date < input.start_date
  ) {
    errors.push('end_date must be on or after start_date')
  }
  if (has('description') && input.description != null && input.description.length > 2000)
    errors.push('description must be at most 2000 characters')
  if (has('people') && input.people != null) {
    if (!Array.isArray(input.people)) errors.push('people must be an array of travellers')
    else if (input.people.length > PEOPLE_MAX) {
      errors.push(`people must have at most ${PEOPLE_MAX} travellers`)
    } else {
      const travellers = input.people.map(normalizeTraveller)
      if (travellers.some((p) => !p.name.trim())) errors.push('each traveller needs a name')
      else if (travellers.some((p) => p.name.trim().length > PERSON_MAX))
        errors.push(`each traveller's name must be at most ${PERSON_MAX} characters`)
      if (travellers.some((p) => p.email && !EMAIL_RE.test(p.email)))
        errors.push('each traveller email must be a valid email address')
    }
  }
  return errors
}

/**
 * Steps and activities are pinned to the trip's dates on the way in, so moving
 * or shortening those dates afterwards is the one move that could strand them.
 * `GET /api/trips/:tripId/date-impact` runs this before the traveller commits,
 * so the sheet can list exactly what is in the way.
 *
 * Stops and activities are treated differently on purpose. An activity sits on
 * a single day, so "move it to the first day" is a sensible offer. A stop is a
 * date range tied to a city — there is no obvious day to move it to, and
 * deleting one rearranges the journey itself, so those stay a hard refusal and
 * are fixed on the journey editor.
 */
async function findStranded(store: DataStore, tripId: string, range: DateRange) {
  const [steps, items] = await Promise.all([store.listSteps(tripId), store.listItinerary(tripId)])
  return {
    steps: steps.filter(
      (s) => !withinRange(s.start_date, range) || !withinRange(s.end_date, range)
    ),
    items: items.filter((i) => !withinRange(i.day, range)),
  }
}

function strandedStepsError(steps: JourneyStep[], range: DateRange): string[] {
  if (!steps.length) return []
  const dates = steps.map((s) => `${s.start_date} – ${s.end_date}`).join(', ')
  return [
    steps.length === 1
      ? `A journey stop (${dates}) falls outside ${rangeLabel(range)} — change it first`
      : `${steps.length} journey stops (${dates}) fall outside ${rangeLabel(range)} — change them first`,
  ]
}

function strandedItemsError(items: ItineraryItem[], range: DateRange): string[] {
  if (!items.length) return []
  const days = [...new Set(items.map((i) => i.day))].sort()
  return [
    days.length === 1
      ? `Activities are planned on ${days[0]}, outside ${rangeLabel(range)} — move or remove them first`
      : `Activities are planned on ${days.length} days (${days.join(', ')}) outside ${rangeLabel(range)} — move or remove them first`,
  ]
}

/** The merged range a date patch would produce, validated. */
async function resolveRange(
  store: DataStore,
  tripId: string,
  patch: { start_date?: string; end_date?: string }
): Promise<DateRange> {
  const current = await store.getTrip(tripId)
  if (!current) throw notFound('Trip')
  const range = {
    start_date: patch.start_date ?? current.start_date,
    end_date: patch.end_date ?? current.end_date,
  }
  if (range.end_date < range.start_date)
    throw validation(['end_date must be on or after start_date'])
  return range
}

/**
 * What changing the dates to `range` would strand — asked by the trip sheet
 * before it saves, so the traveller sees the actual stops and activities
 * rather than a bare error, and picks what happens to them.
 */
export async function getDateImpact(
  store: DataStore,
  tripId: string,
  query: { start_date?: string; end_date?: string }
) {
  const errors: string[] = []
  if (query.start_date !== undefined && !DATE_RE.test(query.start_date))
    errors.push('start_date must be an ISO date (YYYY-MM-DD)')
  if (query.end_date !== undefined && !DATE_RE.test(query.end_date))
    errors.push('end_date must be an ISO date (YYYY-MM-DD)')
  if (errors.length) throw validation(errors)

  const range = await resolveRange(store, tripId, query)
  const stranded = await findStranded(store, tripId, range)
  const zoneNames = await Promise.all(
    stranded.steps.map(async (s) => (await store.getZone(s.zone_id))?.name ?? null)
  )
  return {
    range,
    steps: stranded.steps.map((s, i) => ({
      id: s.id,
      start_date: s.start_date,
      end_date: s.end_date,
      zone_name: zoneNames[i],
    })),
    items: stranded.items.map((i) => ({
      id: i.id,
      day: i.day,
      start_time: i.start_time,
      title: i.title,
      highlight: i.highlight,
    })),
  }
}

export async function createTrip(store: DataStore, input: Partial<TripInput>) {
  const errors = collectTripErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await store.createTrip({
    name: input.name!.trim(),
    start_date: input.start_date!,
    end_date: input.end_date!,
    description: input.description?.trim() || null,
    people: cleanPeople(input.people) ?? [],
  })
  return { trip }
}

/** What to do with activities the new dates would leave outside the trip. */
export const STRANDED_RESOLUTIONS = ['move', 'delete'] as const
export type StrandedResolution = (typeof STRANDED_RESOLUTIONS)[number]

export interface TripPatch extends Partial<TripInput> {
  /** Required (by the client's choice) only when the date change strands activities. */
  stranded_activities?: StrandedResolution
}

export async function updateTrip(store: DataStore, tripId: string, patch: TripPatch) {
  const { stranded_activities: resolution, ...fields } = patch
  const errors = collectTripErrors(fields, true)
  if (resolution !== undefined && !STRANDED_RESOLUTIONS.includes(resolution))
    errors.push(`stranded_activities must be one of: ${STRANDED_RESOLUTIONS.join(', ')}`)
  if (errors.length) throw validation(errors)

  const datesChanged = fields.start_date !== undefined || fields.end_date !== undefined
  let strandedItems: ItineraryItem[] = []
  let range: DateRange | null = null

  if (datesChanged) {
    range = await resolveRange(store, tripId, fields)
    const stranded = await findStranded(store, tripId, range)
    // A stop can only be fixed on the journey editor — no resolution to offer.
    const stepErrors = strandedStepsError(stranded.steps, range)
    if (stepErrors.length) throw validation(stepErrors)
    // Activities can be moved or dropped, but only on an explicit choice: with
    // none, this stays the refusal it was before the sheet learned to ask.
    if (stranded.items.length && !resolution)
      throw validation(strandedItemsError(stranded.items, range))
    strandedItems = stranded.items
  }

  const clean: Partial<TripInput> = { ...fields }
  if (clean.name !== undefined) clean.name = clean.name.trim()
  if (clean.description !== undefined) clean.description = clean.description?.trim() || null
  if (clean.people !== undefined) clean.people = cleanPeople(clean.people)
  const trip = await store.updateTrip(tripId, clean)
  if (!trip) throw notFound('Trip')

  // The trip lands first, then its activities follow it. There is no
  // transaction across the two (the DataStore has none), so the order matters:
  // if the second half fails the dates are already correct and re-saving them
  // with the same choice retries the move/delete.
  const moved: string[] = []
  const deleted: string[] = []
  if (range && strandedItems.length && resolution) {
    for (const item of strandedItems) {
      if (resolution === 'delete') {
        await store.deleteItineraryItem(item.id)
        deleted.push(item.id)
      } else {
        await store.updateItineraryItem(item.id, { day: range.start_date })
        moved.push(item.id)
      }
    }
  }

  return { trip, ...(moved.length && { moved }), ...(deleted.length && { deleted }) }
}

export async function deleteTrip(store: DataStore, tripId: string) {
  const ok = await store.deleteTrip(tripId)
  if (!ok) throw notFound('Trip')
}

export type { Trip }
