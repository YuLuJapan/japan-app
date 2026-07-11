import type { Category, DataStore } from '../lib/datastore'
import { CATEGORIES } from '../lib/datastore'
import { notFound, validation } from '../lib/errors'

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

export async function listZonePlaces(store: DataStore, zoneId: string, category: string) {
  if (!CATEGORIES.includes(category as Category)) {
    throw validation([`category must be one of: ${CATEGORIES.join(', ')}`])
  }
  const zone = await store.getZone(zoneId)
  if (!zone) throw notFound('Zone')
  const places = await store.listPlaces(zoneId, category as Category)
  return {
    places: places.map((p) => ({
      id: p.id,
      name: p.name,
      name_ja: p.name_ja,
      category: p.category,
      summary_line: p.description ? p.description.slice(0, 100) : '',
      image_url: p.image_url ?? null,
    })),
  }
}
