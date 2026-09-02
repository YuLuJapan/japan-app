// Journey steps: which destinations the trip visits and over what date range.
// Order is derived from start_date (see datastore listSteps) — there is no
// manual reordering. A step's destination is either an existing zone_id or a
// free-text destination (validated as a real place via geocode on the
// client); a destination reuses an existing zone when the name matches,
// otherwise a new zone is created on the fly.
import type { DataStore, JourneyStep } from '../lib/datastore.js'
import { requireTrip } from '../lib/access.js'
import { notFound, validation } from '../lib/errors.js'
import { stepView } from '../lib/step-view.js'
import type { DateRange } from '../lib/trip-dates.js'
import { collectRangeErrors, rangeLabel } from '../lib/trip-dates.js'
import type { GeocodeResult } from './geocode.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const NAME_MAX = 80

interface StepFields {
  zone_id?: string
  destination?: GeocodeResult
  start_date?: string
  end_date?: string
}

function collectDestinationErrors(destination: GeocodeResult): string[] {
  const errors: string[] = []
  const name = (destination?.name ?? '').trim()
  if (!name) errors.push('destination.name is required')
  else if (name.length > NAME_MAX)
    errors.push(`destination.name must be at most ${NAME_MAX} characters`)
  if (typeof destination?.lat !== 'number' || destination.lat < -90 || destination.lat > 90)
    errors.push('destination.lat must be a number between -90 and 90')
  if (typeof destination?.lng !== 'number' || destination.lng < -180 || destination.lng > 180)
    errors.push('destination.lng must be a number between -180 and 180')
  return errors
}

function collectErrors(input: StepFields, partial: boolean): string[] {
  const errors: string[] = []
  const has = (k: 'start_date' | 'end_date') => input[k] !== undefined

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
  if (!partial && !input.zone_id && !input.destination) {
    errors.push('zone_id or destination is required')
  }
  if (input.destination) errors.push(...collectDestinationErrors(input.destination))
  return errors
}

/** A step's dates must fall inside the trip's own dates — no stop before it starts or after it ends. */
function collectStepRangeErrors(startDate: string, endDate: string, trip: DateRange): string[] {
  return [
    ...collectRangeErrors('start_date', startDate, trip),
    ...collectRangeErrors('end_date', endDate, trip),
  ]
}

/**
 * Two stops may share exactly one day — the one you check out of the first and
 * into the second — and nothing more. Anything wider is a journey that is in two
 * cities at once, which the day model has no way to read: `primaryStep` ("the
 * city you sleep in that night") silently returns whichever stop was created
 * first, `isTravelDay` calls every shared day a move, and the trip screen bands
 * the day "Earlier / Later" by journey position rather than by the clock. Three
 * separate readings that are only true while this holds, so it is enforced here
 * rather than assumed there.
 *
 * The test is a half-open one: the ranges may touch at a boundary but not cross.
 * That leaves a zero-night stopover legal — a stop whose start and end are the
 * same day, sharing that day with the stop either side of it — which is the one
 * way to express a day trip out of a city you are otherwise based in (split the
 * stay in two and put the day trip between the halves).
 *
 * **One path still gets past this**: `stranded_stops: 'move'` on `PATCH /trips/:id`
 * (`services/trips.ts`, `movedStepDates`) puts *every* stop a shrunk trip no longer
 * covers onto the trip's first day, keeping its length — so two stranded stops land
 * on the same dates, written through `store.updateStep` rather than through the
 * service. Left as it was rather than quietly redesigned: what should happen when a
 * trip shrinks below the stops it holds is a product decision, and the outcome is
 * previewed to the traveller (`moves_to`) before they confirm it.
 */
async function collectOverlapErrors(
  store: DataStore,
  tripId: string,
  startDate: string,
  endDate: string,
  others: JourneyStep[]
): Promise<string[]> {
  const clashes = others.filter((s) => s.end_date > startDate && endDate > s.start_date)
  // Named, not just dated: "overlaps Tokyo (2026-10-05 – 2026-10-09)" says which
  // stop to go and fix, which a pair of dates on its own does not.
  return Promise.all(
    clashes.map(async (s) => {
      const zone = await store.getZone(tripId, s.zone_id)
      const name = zone?.name ?? 'another stop'
      return `this stop overlaps ${name} (${rangeLabel(s)}) — two stops can only share the day you move between them`
    })
  )
}

/** Resolve a zone_id or free-text destination to a zone id, creating the zone if needed. */
async function resolveZoneId(
  store: DataStore,
  tripId: string,
  zoneId: string | undefined,
  destination: GeocodeResult | undefined
): Promise<string> {
  if (zoneId) {
    const zone = await store.getZone(tripId, zoneId)
    if (!zone) throw notFound('Zone')
    return zone.id
  }
  // Find-or-create is now per trip: two trips to Tokyo each get their own
  // Tokyo, with their own places and notes, rather than sharing one.
  const name = destination!.name.trim()
  const zones = await store.listZones(tripId)
  const existing = zones.find((z) => z.name.trim().toLowerCase() === name.toLowerCase())
  if (existing) return existing.id
  const created = await store.createZone({
    trip_id: tripId,
    name,
    lat: destination!.lat,
    lng: destination!.lng,
  })
  return created.id
}

export async function createStep(
  store: DataStore,
  tripId: string,
  input: StepFields,
  { includeStays = true }: { includeStays?: boolean } = {}
) {
  const errors = collectErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await requireTrip(store, tripId)
  const rangeErrors = collectStepRangeErrors(input.start_date!, input.end_date!, trip)
  if (rangeErrors.length) throw validation(rangeErrors)
  // Before `resolveZoneId`, which creates a zone for a new destination: a
  // rejected create must not leave one behind.
  const steps = await store.listSteps(trip.id)
  const overlapErrors = await collectOverlapErrors(
    store,
    trip.id,
    input.start_date!,
    input.end_date!,
    steps
  )
  if (overlapErrors.length) throw validation(overlapErrors)
  const zoneId = await resolveZoneId(store, tripId, input.zone_id, input.destination)
  const nextPosition = steps.reduce((max, s) => Math.max(max, s.position), 0) + 1
  const step = await store.createStep({
    trip_id: trip.id,
    zone_id: zoneId,
    start_date: input.start_date!,
    end_date: input.end_date!,
    position: nextPosition,
  })
  // The journey-card shape, not the bare row: a write answers with what the
  // list it changed actually renders (lib/step-view.ts).
  return { step: await stepView(store, trip.id, step, { includeStays }) }
}

export async function updateStep(
  store: DataStore,
  tripId: string,
  stepId: string,
  patch: StepFields,
  { includeStays = true }: { includeStays?: boolean } = {}
) {
  const errors = collectErrors(patch, true)
  if (errors.length) throw validation(errors)
  const existing = await store.getStep(tripId, stepId)
  if (!existing) throw notFound('Journey step')

  const mergedStart = patch.start_date ?? existing.start_date
  const mergedEnd = patch.end_date ?? existing.end_date
  if (mergedEnd < mergedStart) throw validation(['end_date must be on or after start_date'])

  const trip = await store.getTrip(existing.trip_id)
  if (!trip) throw notFound('Trip')
  const rangeErrors = collectStepRangeErrors(mergedStart, mergedEnd, trip)
  if (rangeErrors.length) throw validation(rangeErrors)

  // Checked on the merged dates and on every write, not only a dated one: an
  // edit that moves a stop's city is as able to produce an overlap as one that
  // moves its dates, and the row it must not collide with is every *other* stop.
  const overlapErrors = await collectOverlapErrors(
    store,
    tripId,
    mergedStart,
    mergedEnd,
    (await store.listSteps(tripId)).filter((s) => s.id !== stepId)
  )
  if (overlapErrors.length) throw validation(overlapErrors)

  const zoneId =
    patch.zone_id || patch.destination
      ? await resolveZoneId(store, tripId, patch.zone_id, patch.destination)
      : undefined

  const step = await store.updateStep(tripId, stepId, {
    zone_id: zoneId,
    start_date: patch.start_date,
    end_date: patch.end_date,
  })
  if (!step) throw notFound('Journey step')
  return { step: await stepView(store, tripId, step, { includeStays }) }
}

export async function deleteStep(store: DataStore, tripId: string, stepId: string) {
  const ok = await store.deleteStep(tripId, stepId)
  if (!ok) throw notFound('Journey step')
}
