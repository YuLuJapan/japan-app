// Shopping list: the things we want to buy in Japan — what it is, where to buy
// it, what it should cost, a photo, and whether it's been bought.
import type { DataStore, ShoppingCategory, ShoppingItemInput } from '../lib/datastore.js'
import { SHOPPING_CATEGORIES } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'

const MAX_PRICE_YEN = 10_000_000
const isHttpUrl = (u: string) => /^https?:\/\/.+/.test(u)

export async function listShoppingItems(store: DataStore) {
  const trip = await store.getTrip()
  if (!trip) throw notFound('Trip')
  const items = await store.listShoppingItems(trip.id)
  return { items }
}

function collectShoppingErrors(input: Partial<ShoppingItemInput>, partial: boolean): string[] {
  const errors: string[] = []
  const has = (k: keyof ShoppingItemInput) => input[k] !== undefined

  if (!partial || has('name')) {
    const name = (input.name ?? '').trim()
    if (!name) errors.push('name is required')
    else if (name.length > 120) errors.push('name must be at most 120 characters')
  }
  if (has('category') && input.category != null) {
    if (!SHOPPING_CATEGORIES.includes(input.category as ShoppingCategory))
      errors.push(`category must be one of: ${SHOPPING_CATEGORIES.join(', ')}`)
  }
  if (has('note') && (input.note ?? '').length > 1000)
    errors.push('note must be at most 1000 characters')
  if (has('shop') && (input.shop ?? '').length > 120)
    errors.push('shop must be at most 120 characters')
  if (has('price_yen') && input.price_yen != null) {
    const price = input.price_yen
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > MAX_PRICE_YEN)
      errors.push(`price_yen must be a number between 0 and ${MAX_PRICE_YEN}`)
  }
  if (has('url') && input.url != null && input.url !== '' && !isHttpUrl(input.url))
    errors.push('url must start with http(s)://')
  if (
    has('image_url') &&
    input.image_url != null &&
    input.image_url !== '' &&
    !isHttpUrl(input.image_url)
  )
    errors.push('image_url must start with http(s)://')
  if (has('bought') && input.bought != null && typeof input.bought !== 'boolean')
    errors.push('bought must be a boolean')
  return errors
}

/** Trim strings and turn empty optional fields into nulls (one shape for POST + PATCH). */
function clean(input: Partial<ShoppingItemInput>): Partial<ShoppingItemInput> {
  const out: Partial<ShoppingItemInput> = { ...input }
  if (out.name !== undefined) out.name = out.name.trim()
  if (out.note !== undefined) out.note = out.note?.trim() || null
  if (out.shop !== undefined) out.shop = out.shop?.trim() || null
  if (out.url !== undefined) out.url = out.url?.trim() || null
  if (out.image_url !== undefined) out.image_url = out.image_url?.trim() || null
  if (out.price_yen !== undefined) out.price_yen = out.price_yen ?? null
  return out
}

export async function createShoppingItem(store: DataStore, input: ShoppingItemInput) {
  const errors = collectShoppingErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await store.getTrip()
  if (!trip) throw notFound('Trip')
  if (input.zone_id) {
    if (!(await store.getZone(input.zone_id))) throw notFound('Zone')
  }
  const item = await store.createShoppingItem({
    ...clean(input),
    trip_id: trip.id,
  } as ShoppingItemInput)
  return { item }
}

export async function updateShoppingItem(
  store: DataStore,
  itemId: string,
  patch: Partial<ShoppingItemInput>
) {
  const errors = collectShoppingErrors(patch, true)
  if (errors.length) throw validation(errors)
  if (patch.zone_id) {
    if (!(await store.getZone(patch.zone_id))) throw notFound('Zone')
  }
  const item = await store.updateShoppingItem(itemId, clean(patch))
  if (!item) throw notFound('Shopping item')
  return { item }
}

export async function deleteShoppingItem(store: DataStore, itemId: string) {
  const ok = await store.deleteShoppingItem(itemId)
  if (!ok) throw notFound('Shopping item')
}
