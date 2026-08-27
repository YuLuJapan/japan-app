import type { Category, DataStore, PlaceInput, PlaceLink } from '../lib/datastore.js'
import { CATEGORIES } from '../lib/datastore.js'
// Scope is a store argument now, not a check the service has to remember —
// see the DataStore interface. lib/access.ts's reachability helpers are gone.

import { forbidden, notFound, validation } from '../lib/errors.js'
import { placeView } from '../lib/place-view.js'
import { isStay } from '../lib/trip-view.js'

/**
 * `includeFiles: false` withholds attachments — they never leave the server.
 * `includeStays: false` is the same view's other half: a stay is the booking
 * itself (lib/trip-view.ts), so a member without them is refused the page outright.
 */
export async function getPlaceDetail(
  store: DataStore,
  tripId: string,
  placeId: string,
  {
    includeFiles = true,
    includeStays = true,
  }: { includeFiles?: boolean; includeStays?: boolean } = {}
) {
  // The store answers "not in this trip" and "no such place" identically, so
  // an outsider cannot tell the two apart.
  const place = await store.getPlace(tripId, placeId)
  if (!place) throw notFound('Place')
  if (!includeStays && isStay(place)) {
    throw forbidden('Where this trip is staying is not shared with you')
  }
  const [tips, files] = await Promise.all([
    store.listTips(tripId, { place_id: placeId }),
    includeFiles ? store.listFiles(tripId, { place_id: placeId }) : [],
  ])
  return {
    place: placeView(place),
    tips,
    files: files.map(({ id, display_name, mime_type, size_bytes }) => ({
      id,
      display_name,
      mime_type,
      size_bytes,
    })),
  }
}

const isHttpUrl = (u: string) => /^https?:\/\/.+/.test(u)

function collectPlaceErrors(input: Partial<PlaceInput>, partial: boolean): string[] {
  const errors: string[] = []
  const has = (k: keyof PlaceInput) => input[k] !== undefined

  if (!partial || has('name')) {
    const name = (input.name ?? '').trim()
    if (!name) errors.push('name is required')
    else if (name.length > 120) errors.push('name must be at most 120 characters')
  }
  if (!partial || has('category')) {
    if (!CATEGORIES.includes(input.category as Category))
      errors.push(`category must be one of: ${CATEGORIES.join(', ')}`)
  }
  if (!partial && !input.zone_id) errors.push('zone_id is required')
  if (has('links') && input.links != null) {
    if (!Array.isArray(input.links)) errors.push('links must be an array')
    else {
      for (const link of input.links as PlaceLink[]) {
        if (!link?.label?.trim()) errors.push('every link needs a label')
        if (!link?.url || !isHttpUrl(link.url))
          errors.push('every link url must start with http(s)://')
      }
    }
  }
  if (has('description') && (input.description ?? '').length > 5000)
    errors.push('description must be at most 5000 characters')
  if (
    has('image_url') &&
    input.image_url != null &&
    input.image_url !== '' &&
    !isHttpUrl(input.image_url)
  )
    errors.push('image_url must start with http(s)://')
  if (
    has('lat') &&
    input.lat != null &&
    (typeof input.lat !== 'number' || input.lat < -90 || input.lat > 90)
  )
    errors.push('lat must be a number between -90 and 90')
  if (
    has('lng') &&
    input.lng != null &&
    (typeof input.lng !== 'number' || input.lng < -180 || input.lng > 180)
  )
    errors.push('lng must be a number between -180 and 180')
  return errors
}

export async function createPlace(store: DataStore, tripId: string, input: PlaceInput) {
  const errors = collectPlaceErrors(input, false)
  if (errors.length) throw validation(errors)
  const zone = await store.getZone(tripId, input.zone_id)
  if (!zone) throw notFound('Zone')
  const place = await store.createPlace(tripId, { ...input, name: input.name.trim() })
  return { place: placeView(place) }
}

export async function updatePlace(
  store: DataStore,
  tripId: string,
  placeId: string,
  patch: Partial<PlaceInput>
) {
  const errors = collectPlaceErrors(patch, true)
  if (errors.length) throw validation(errors)
  if (patch.zone_id) {
    // Both ends have to be in this trip, or a place could be moved into
    // someone else's city. The store enforces it too; this is what turns
    // that into a 404 rather than a silent no-op.
    const zone = await store.getZone(tripId, patch.zone_id)
    if (!zone) throw notFound('Zone')
  }
  const place = await store.updatePlace(tripId, placeId, patch)
  if (!place) throw notFound('Place')
  return { place: placeView(place) }
}

export async function deletePlace(store: DataStore, tripId: string, placeId: string) {
  const place = await store.getPlace(tripId, placeId)
  if (!place) throw notFound('Place')
  // no silent file loss (data-model.md): move the place's files to the trip
  // first. That trip is the one in the path, so a place deleted from one trip
  // cannot dump its files on another.
  await store.reparentFilesToTrip(placeId, tripId)
  await store.deletePlace(tripId, placeId)
}
