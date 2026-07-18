// Journey steps: which destinations the trip visits and over what date range.
// Order is derived from start_date (see datastore listSteps) — there is no
// manual reordering. A step's destination is either an existing zone_id or a
// free-text destination (validated as a real place via geocode on the
// client); a destination reuses an existing zone when the name matches,
// otherwise a new zone is created on the fly.
import type { DataStore } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'
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
  else if (name.length > NAME_MAX) errors.push(`destination.name must be at most ${NAME_MAX} characters`)
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

/** Resolve a zone_id or free-text destination to a zone id, creating the zone if needed. */
async function resolveZoneId(
  store: DataStore,
  zoneId: string | undefined,
  destination: GeocodeResult | undefined
): Promise<string> {
  if (zoneId) {
    const zone = await store.getZone(zoneId)
    if (!zone) throw notFound('Zone')
    return zone.id
  }
  const name = destination!.name.trim()
  const zones = await store.listZones()
  const existing = zones.find((z) => z.name.trim().toLowerCase() === name.toLowerCase())
  if (existing) return existing.id
  const created = await store.createZone({ name, lat: destination!.lat, lng: destination!.lng })
  return created.id
}

export async function createStep(store: DataStore, input: StepFields) {
  const errors = collectErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await store.getTrip()
  if (!trip) throw notFound('Trip')
  const zoneId = await resolveZoneId(store, input.zone_id, input.destination)
  const steps = await store.listSteps(trip.id)
  const nextPosition = steps.reduce((max, s) => Math.max(max, s.position), 0) + 1
  const step = await store.createStep({
    trip_id: trip.id,
    zone_id: zoneId,
    start_date: input.start_date!,
    end_date: input.end_date!,
    position: nextPosition,
  })
  return { step }
}

export async function updateStep(store: DataStore, stepId: string, patch: StepFields) {
  const errors = collectErrors(patch, true)
  if (errors.length) throw validation(errors)
  const existing = await store.getStep(stepId)
  if (!existing) throw notFound('Journey step')

  const mergedStart = patch.start_date ?? existing.start_date
  const mergedEnd = patch.end_date ?? existing.end_date
  if (mergedEnd < mergedStart) throw validation(['end_date must be on or after start_date'])

  const zoneId =
    patch.zone_id || patch.destination
      ? await resolveZoneId(store, patch.zone_id, patch.destination)
      : undefined

  const step = await store.updateStep(stepId, {
    zone_id: zoneId,
    start_date: patch.start_date,
    end_date: patch.end_date,
  })
  if (!step) throw notFound('Journey step')
  return { step }
}

export async function deleteStep(store: DataStore, stepId: string) {
  const ok = await store.deleteStep(stepId)
  if (!ok) throw notFound('Journey step')
}
