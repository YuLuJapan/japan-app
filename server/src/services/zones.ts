import type { Category, DataStore } from '../lib/datastore.js'
import { CATEGORIES } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'

// The trip's fixed zone catalog — used to pick a zone when adding a stop.
export async function listAllZones(store: DataStore) {
  return { zones: await store.listZones() }
}

export async function getZoneDetail(store: DataStore, zoneId: string) {
  const zone = await store.getZone(zoneId)
  if (!zone) throw notFound('Zone')
  const [tips, files, place_counts] = await Promise.all([
    store.listTips({ zone_id: zoneId }),
    store.listFiles({ zone_id: zoneId }),
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
    place_counts,
  }
}

// category === '' means "every category" (used by the city map, which plots
// all of a zone's places and filters client-side).
export async function listZonePlaces(store: DataStore, zoneId: string, category: string) {
  if (category !== '' && !CATEGORIES.includes(category as Category)) {
    throw validation([`category must be one of: ${CATEGORIES.join(', ')}`])
  }
  const zone = await store.getZone(zoneId)
  if (!zone) throw notFound('Zone')
  const places = category
    ? await store.listPlaces(zoneId, category as Category)
    : await store.listPlacesInZone(zoneId)
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
