// GET /api/trip response shape (contracts/api.md): the whole journey skeleton
// in one call — trip, ordered steps with embedded zone summaries + counts.
import type { DataStore } from '../lib/datastore.js'
import { notFound } from '../lib/errors.js'

export async function getTripBundle(store: DataStore) {
  const trip = await store.getTrip()
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
  return { trip, steps: stepsWithZones, trip_files_count }
}
