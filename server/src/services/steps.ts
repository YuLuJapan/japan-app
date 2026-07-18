// Journey steps: which zones the trip visits, in what order, over what date
// range. Position is a dense 1..N sequence per trip; create appends to the
// end, delete compacts the gap, and move swaps with the adjacent step via a
// sentinel position (avoids the DB's unique(trip_id, position) constraint
// ever seeing two rows share a position mid-update).
import type { DataStore, JourneyStep, JourneyStepInput } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MOVE_SENTINEL = -1

function collectErrors(input: Partial<JourneyStepInput>, partial: boolean): string[] {
  const errors: string[] = []
  const has = (k: keyof JourneyStepInput) => input[k] !== undefined

  if (!partial || has('zone_id')) {
    if (!input.zone_id) errors.push('zone_id is required')
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
  return errors
}

export async function createStep(store: DataStore, input: JourneyStepInput) {
  const errors = collectErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await store.getTrip()
  if (!trip) throw notFound('Trip')
  const zone = await store.getZone(input.zone_id)
  if (!zone) throw notFound('Zone')
  const steps = await store.listSteps(trip.id)
  const nextPosition = steps.reduce((max, s) => Math.max(max, s.position), 0) + 1
  const step = await store.createStep({
    trip_id: trip.id,
    zone_id: input.zone_id,
    start_date: input.start_date,
    end_date: input.end_date,
    position: nextPosition,
  })
  return { step }
}

export async function updateStep(
  store: DataStore,
  stepId: string,
  patch: Partial<JourneyStepInput>
) {
  const errors = collectErrors(patch, true)
  if (errors.length) throw validation(errors)
  const existing = await store.getStep(stepId)
  if (!existing) throw notFound('Journey step')
  if (patch.zone_id) {
    const zone = await store.getZone(patch.zone_id)
    if (!zone) throw notFound('Zone')
  }
  const mergedStart = patch.start_date ?? existing.start_date
  const mergedEnd = patch.end_date ?? existing.end_date
  if (mergedEnd < mergedStart) throw validation(['end_date must be on or after start_date'])

  const step = await store.updateStep(stepId, {
    zone_id: patch.zone_id,
    start_date: patch.start_date,
    end_date: patch.end_date,
  })
  if (!step) throw notFound('Journey step')
  return { step }
}

export async function deleteStep(store: DataStore, stepId: string) {
  const existing = await store.getStep(stepId)
  if (!existing) throw notFound('Journey step')
  const ok = await store.deleteStep(stepId)
  if (!ok) throw notFound('Journey step')

  // compact the gap so positions stay a dense 1..N sequence
  const later = (await store.listSteps(existing.trip_id))
    .filter((s) => s.position > existing.position)
    .sort((a, b) => a.position - b.position)
  for (const s of later) {
    await store.updateStep(s.id, { position: s.position - 1 })
  }
}

export async function moveStep(store: DataStore, stepId: string, direction: unknown) {
  if (direction !== 'up' && direction !== 'down') {
    throw validation(['direction must be "up" or "down"'])
  }
  const existing = await store.getStep(stepId)
  if (!existing) throw notFound('Journey step')

  const steps = (await store.listSteps(existing.trip_id)).sort((a, b) => a.position - b.position)
  const idx = steps.findIndex((s) => s.id === stepId)
  const neighborIdx = direction === 'up' ? idx - 1 : idx + 1
  if (neighborIdx < 0 || neighborIdx >= steps.length) return { steps }

  const a = steps[idx]
  const b = steps[neighborIdx]
  // capture as primitives before mutating — some backends (e.g. the memory
  // store) return live object references from listSteps, so re-reading
  // a.position/b.position after an intervening updateStep would see the
  // already-mutated value instead of the original
  const aPos = a.position
  const bPos = b.position
  await store.updateStep(a.id, { position: MOVE_SENTINEL })
  await store.updateStep(b.id, { position: aPos })
  await store.updateStep(a.id, { position: bPos })

  const updated = await store.listSteps(existing.trip_id)
  return { steps: updated as JourneyStep[] }
}
