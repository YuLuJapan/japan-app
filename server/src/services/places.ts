import type { Category, DataStore, PlaceInput, PlaceLink } from '../lib/datastore.js'
import { CATEGORIES } from '../lib/datastore.js'
import {
  assertZoneAccess,
  canReachZone,
  reachableZoneIds,
  resolveTrip,
  type AccessContext,
} from '../lib/access.js'
import { forbidden, notFound, validation } from '../lib/errors.js'
import { isStay } from '../lib/guest-view.js'

/**
 * `includeFiles: false` is the guest view — attachments never leave the server.
 * `includeStays: false` is the same view's other half: a stay is the booking
 * itself (lib/guest-view.ts), so guests are refused the page outright.
 */
export async function getPlaceDetail(
  store: DataStore,
  access: AccessContext,
  placeId: string,
  {
    includeFiles = true,
    includeStays = true,
  }: { includeFiles?: boolean; includeStays?: boolean } = {}
) {
  const place = await store.getPlace(placeId)
  if (!place) throw notFound('Place')
  // A place is only as reachable as its zone. Reported as a missing *place*
  // so an outsider cannot tell "no such place" from "not your city".
  if (!canReachZone(await reachableZoneIds(store, access), place.zone_id)) throw notFound('Place')
  if (!includeStays && isStay(place)) {
    throw forbidden('Stays are not part of the guest view')
  }
  const [tips, files] = await Promise.all([
    store.listTips({ place_id: placeId }),
    includeFiles ? store.listFiles({ place_id: placeId }) : [],
  ])
  return {
    place,
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

export async function createPlace(store: DataStore, access: AccessContext, input: PlaceInput) {
  const errors = collectPlaceErrors(input, false)
  if (errors.length) throw validation(errors)
  assertZoneAccess(await reachableZoneIds(store, access), input.zone_id)
  const zone = await store.getZone(input.zone_id)
  if (!zone) throw notFound('Zone')
  const place = await store.createPlace({ ...input, name: input.name.trim() })
  return { place }
}

export async function updatePlace(
  store: DataStore,
  access: AccessContext,
  placeId: string,
  patch: Partial<PlaceInput>
) {
  const errors = collectPlaceErrors(patch, true)
  if (errors.length) throw validation(errors)
  const zones = await reachableZoneIds(store, access)
  const existing = await store.getPlace(placeId)
  if (!existing) throw notFound('Place')
  assertZoneAccess(zones, existing.zone_id)
  if (patch.zone_id) {
    // Both ends have to be yours, or a place could be moved into someone
    // else's city.
    assertZoneAccess(zones, patch.zone_id)
    const zone = await store.getZone(patch.zone_id)
    if (!zone) throw notFound('Zone')
  }
  const place = await store.updatePlace(placeId, patch)
  if (!place) throw notFound('Place')
  return { place }
}

export async function deletePlace(
  store: DataStore,
  access: AccessContext,
  tripId: string,
  placeId: string
) {
  const place = await store.getPlace(placeId)
  if (!place) throw notFound('Place')
  assertZoneAccess(await reachableZoneIds(store, access), place.zone_id)
  // no silent file loss (data-model.md): move the place's files to the trip
  // first. That trip is now the one in the path rather than the caller's
  // oldest, so a place deleted from one trip cannot dump its files on another.
  const trip = await resolveTrip(store, access, tripId)
  await store.reparentFilesToTrip(placeId, trip.id)
  await store.deletePlace(placeId)
}
