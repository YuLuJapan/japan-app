import type { Category, DataStore } from '../lib/datastore.js'
import { CATEGORIES } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'
import { hideStayCounts, isStay } from '../lib/trip-view.js'

/**
 * A zone belongs to exactly one trip since migration 0013, so the store answers
 * "not in this trip" and "no such zone" identically — which is what we want an
 * outsider to see. The reachability workaround this replaced lived in
 * lib/access.ts and had to walk journey steps on every read.
 *
 * `includeFiles: false` keeps attachments on the server; `includeStays: false`
 * drops the stays from the counts (lib/trip-view.ts).
 */
export async function getZoneDetail(
  store: DataStore,
  tripId: string,
  zoneId: string,
  {
    includeFiles = true,
    includeStays = true,
  }: { includeFiles?: boolean; includeStays?: boolean } = {}
) {
  const zone = await store.getZone(tripId, zoneId)
  if (!zone) throw notFound('Zone')
  const [tips, files, place_counts] = await Promise.all([
    store.listTips(tripId, { zone_id: zoneId }),
    includeFiles ? store.listFiles(tripId, { zone_id: zoneId }) : [],
    store.countPlacesByCategory(tripId, zoneId),
  ])
  return {
    zone,
    tips,
    files: files.map(({ id, display_name, mime_type, size_bytes }) => ({
      id,
      display_name,
      mime_type,
      size_bytes,
    })),
    place_counts: includeStays ? place_counts : hideStayCounts(place_counts),
  }
}

// category === '' means "every category" (used by the city map, which plots
// all of a zone's places and filters client-side).
export async function listZonePlaces(
  store: DataStore,
  tripId: string,
  zoneId: string,
  category: string,
  { includeStays = true }: { includeStays?: boolean } = {}
) {
  if (category !== '' && !CATEGORIES.includes(category as Category)) {
    throw validation([`category must be one of: ${CATEGORIES.join(', ')}`])
  }
  const zone = await store.getZone(tripId, zoneId)
  if (!zone) throw notFound('Zone')
  const all = category
    ? await store.listPlaces(tripId, zoneId, category as Category)
    : await store.listPlacesInZone(tripId, zoneId)
  // Covers both shapes: asking for the stays themselves, and the map's
  // all-categories sweep that would otherwise carry them along.
  const places = includeStays ? all : all.filter((p) => !isStay(p))
  return {
    places: places.map((p) => ({
      id: p.id,
      name: p.name,
      name_ja: p.name_ja,
      category: p.category,
      summary_line: p.description ? p.description.slice(0, 100) : '',
      image_url: p.image_url ?? null,
      address: p.address ?? null,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
    })),
  }
}
