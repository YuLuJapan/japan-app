import type { Category, DataStore, PlaceInput, PlaceLink } from '../lib/datastore.js'
import { CATEGORIES } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'

export async function getPlaceDetail(store: DataStore, placeId: string) {
  const place = await store.getPlace(placeId)
  if (!place) throw notFound('Place')
  const [tips, files] = await Promise.all([
    store.listTips({ place_id: placeId }),
    store.listFiles({ place_id: placeId }),
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
        if (!link?.url || !isHttpUrl(link.url)) errors.push('every link url must start with http(s)://')
      }
    }
  }
  if (has('description') && (input.description ?? '').length > 5000)
    errors.push('description must be at most 5000 characters')
  if (has('image_url') && input.image_url != null && input.image_url !== '' && !isHttpUrl(input.image_url))
    errors.push('image_url must start with http(s)://')
  if (has('lat') && input.lat != null && (typeof input.lat !== 'number' || input.lat < -90 || input.lat > 90))
    errors.push('lat must be a number between -90 and 90')
  if (has('lng') && input.lng != null && (typeof input.lng !== 'number' || input.lng < -180 || input.lng > 180))
    errors.push('lng must be a number between -180 and 180')
  return errors
}

export async function createPlace(store: DataStore, input: PlaceInput) {
  const errors = collectPlaceErrors(input, false)
  if (errors.length) throw validation(errors)
  const zone = await store.getZone(input.zone_id)
  if (!zone) throw notFound('Zone')
  const place = await store.createPlace({ ...input, name: input.name.trim() })
  return { place }
}

export async function updatePlace(store: DataStore, placeId: string, patch: Partial<PlaceInput>) {
  const errors = collectPlaceErrors(patch, true)
  if (errors.length) throw validation(errors)
  if (patch.zone_id) {
    const zone = await store.getZone(patch.zone_id)
    if (!zone) throw notFound('Zone')
  }
  const place = await store.updatePlace(placeId, patch)
  if (!place) throw notFound('Place')
  return { place }
}

export async function deletePlace(store: DataStore, placeId: string) {
  const place = await store.getPlace(placeId)
  if (!place) throw notFound('Place')
  // no silent file loss (data-model.md): move the place's files to the trip first
  const trip = await store.getTrip()
  if (trip) await store.reparentFilesToTrip(placeId, trip.id)
  await store.deletePlace(placeId)
}
