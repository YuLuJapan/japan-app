import type { DataStore, ZonePatch } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'

import { hideStayCounts } from '../lib/trip-view.js'

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
  const [tips, files, saved_counts] = await Promise.all([
    store.listTips(tripId, { zone_id: zoneId }),
    includeFiles ? store.listFiles(tripId, { zone_id: zoneId }) : [],
    store.countSavedByCategory(tripId, zoneId),
  ])
  return {
    zone,
    tips,
    files: files.map(({ id, display_name, mime_type, size_bytes }: (typeof files)[number]) => ({
      id,
      display_name,
      mime_type,
      size_bytes,
    })),
    saved_counts: includeStays ? saved_counts : hideStayCounts(saved_counts),
  }
}

// `listZonePlaces` is gone. Before 010 the city map and the category list each
// needed their own zone-scoped read; both now filter the single
// `GET /activities` list client-side, so the endpoint it backed would be a
// subset of a list the caller already has (plan.md, "Client").

const isHttpUrl = (u: string) => /^https?:\/\/.+/.test(u)
const IMAGE_URL_MAX = 2000

/**
 * Change a zone's photo.
 *
 * Zones were read-only until now: the seeded `image_url` from migration 0001
 * was the only one a zone could ever have. Only the photo is writable — the
 * name, its Japanese reading and the summary are what journey steps and the
 * search index read, and none of that is asked for yet.
 *
 * No permission check here. Every route under `/api/trips/:tripId` sits behind
 * `requireTripAccess`, which refuses a write from any role that cannot make one
 * and answers 404 for a trip that isn't yours — so a service that re-checked
 * would be duplicating the choke point, not adding to it.
 */
export async function updateZone(
  store: DataStore,
  tripId: string,
  zoneId: string,
  input: Partial<ZonePatch>
) {
  const errors: string[] = []
  const patch: ZonePatch = {}
  if (input.image_url !== undefined) {
    const url = input.image_url
    if (url === null || url === '') {
      // Clearing it is a real choice: ZoneImage falls back to its gradient,
      // which beats a photo that turned out to be of the wrong place.
      patch.image_url = null
    } else if (typeof url !== 'string' || !isHttpUrl(url)) {
      errors.push('image_url must start with http(s)://')
    } else if (url.length > IMAGE_URL_MAX) {
      errors.push(`image_url must be at most ${IMAGE_URL_MAX} characters`)
    } else {
      patch.image_url = url.trim()
    }
  }
  if (errors.length) throw validation(errors)
  const zone = await store.updateZone(tripId, zoneId, patch)
  if (!zone) throw notFound('Zone')
  return { zone }
}
