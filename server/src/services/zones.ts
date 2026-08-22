import type { Category, DataStore } from '../lib/datastore.js'
import { CATEGORIES } from '../lib/datastore.js'
import { assertZoneAccess, reachableZoneIds, type AccessContext } from '../lib/access.js'
import { notFound, validation } from '../lib/errors.js'
import { hideStayCounts, isStay } from '../lib/guest-view.js'

/**
 * `includeFiles: false` is the guest view — attachments never leave the server.
 * `includeStays: false` drops the stays from the counts (lib/guest-view.ts).
 */
export async function getZoneDetail(
  store: DataStore,
  access: AccessContext,
  zoneId: string,
  {
    includeFiles = true,
    includeStays = true,
  }: { includeFiles?: boolean; includeStays?: boolean } = {}
) {
  assertZoneAccess(await reachableZoneIds(store, access), zoneId)
  const zone = await store.getZone(zoneId)
  if (!zone) throw notFound('Zone')
  const [tips, files, place_counts] = await Promise.all([
    store.listTips({ zone_id: zoneId }),
    includeFiles ? store.listFiles({ zone_id: zoneId }) : [],
    store.countPlacesByCategory(zoneId),
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
  access: AccessContext,
  zoneId: string,
  category: string,
  { includeStays = true }: { includeStays?: boolean } = {}
) {
  if (category !== '' && !CATEGORIES.includes(category as Category)) {
    throw validation([`category must be one of: ${CATEGORIES.join(', ')}`])
  }
  assertZoneAccess(await reachableZoneIds(store, access), zoneId)
  const zone = await store.getZone(zoneId)
  if (!zone) throw notFound('Zone')
  const all = category
    ? await store.listPlaces(zoneId, category as Category)
    : await store.listPlacesInZone(zoneId)
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
