import type { DataStore, TipInput } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'

function collectTipErrors(input: TipInput): string[] {
  const errors: string[] = []
  const body = (input.body ?? '').trim()
  if (!body) errors.push('body is required')
  else if (body.length > 1000) errors.push('body must be at most 1000 characters')
  const parents = [input.zone_id, input.place_id].filter((v) => v != null)
  if (parents.length !== 1) errors.push('a tip must have exactly one parent: zone_id or place_id')
  return errors
}

export async function createTip(store: DataStore, input: TipInput) {
  const errors = collectTipErrors(input)
  if (errors.length) throw validation(errors)
  if (input.zone_id) {
    if (!(await store.getZone(input.zone_id))) throw notFound('Zone')
  } else if (input.place_id) {
    if (!(await store.getPlace(input.place_id))) throw notFound('Place')
  }
  const tip = await store.createTip({ ...input, body: input.body.trim() })
  return { tip }
}

export async function updateTip(store: DataStore, tipId: string, body: unknown) {
  const trimmed = typeof body === 'string' ? body.trim() : ''
  if (!trimmed) throw validation(['body is required'])
  if (trimmed.length > 1000) throw validation(['body must be at most 1000 characters'])
  const tip = await store.updateTip(tipId, trimmed)
  if (!tip) throw notFound('Tip')
  return { tip }
}

export async function deleteTip(store: DataStore, tipId: string) {
  const ok = await store.deleteTip(tipId)
  if (!ok) throw notFound('Tip')
}
