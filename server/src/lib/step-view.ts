// What a journey step looks like on the trip bundle — the shape the journey
// cards render.
//
// A step's own row carries dates and a zone *id*; the card needs the zone
// itself, name and photo and category counts. That assembly used to live only
// inside the bundle builder, which meant `POST`/`PATCH /steps` answered with
// something narrower than the list they change, and a client could not put the
// step it had just saved back onto the journey. Both go through here now, so
// the write returns exactly what the read does.
import type { Category, DataStore, JourneyStep } from './datastore.js'
import { hideStayCounts } from './trip-view.js'

export async function stepView(
  store: DataStore,
  tripId: string,
  step: JourneyStep,
  { includeStays = true }: { includeStays?: boolean } = {}
) {
  const zone = await store.getZone(tripId, step.zone_id)
  const counts: Record<Category, number> = await store.countPlacesByCategory(tripId, step.zone_id)
  const place_counts = includeStays ? counts : hideStayCounts(counts)
  return {
    id: step.id,
    position: step.position,
    start_date: step.start_date,
    end_date: step.end_date,
    zone: zone ? { ...zone, place_counts } : null,
  }
}
