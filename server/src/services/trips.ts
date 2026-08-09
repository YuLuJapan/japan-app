// Trips: the top-level "which journey is this" entity. GET /api/trips lists
// them all (the "Where to next?" screen); GET /api/trips/:tripId returns the
// full journey skeleton for one (steps + zones + flight + file count).
import type { DataStore, Trip, TripInput } from '../lib/datastore.js'
import { getDefaultTrip, normalizeTraveller } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'
import { FLIGHT } from '../lib/flight.js'

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

export async function updateTrip(store: DataStore, tripId: string, patch: Partial<TripInput>) {
  const errors = collectTripErrors(patch, true)
  if (errors.length) throw validation(errors)
  const clean: Partial<TripInput> = { ...patch }
  if (clean.name !== undefined) clean.name = clean.name.trim()
  if (clean.description !== undefined) clean.description = clean.description?.trim() || null
  if (clean.people !== undefined) clean.people = cleanPeople(clean.people)
  const trip = await store.updateTrip(tripId, clean)
  if (!trip) throw notFound('Trip')
  return { trip }
}

export async function deleteTrip(store: DataStore, tripId: string) {
  const ok = await store.deleteTrip(tripId)
  if (!ok) throw notFound('Trip')
}

export type { Trip }
