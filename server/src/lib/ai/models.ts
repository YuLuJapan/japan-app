// The model catalogue. One source of truth for which models exist, what they
// cost, and how much they can hold.
//
// **`ModelId` is derived from this table**, not declared beside it. That is the
// whole mechanism: a model cannot be referenced anywhere in the app without
// appearing here, and it cannot appear here without four prices and a context
// limit, so `npm run typecheck` refuses a model nobody has costed (FR-028).
//
// The failure this prevents is quiet. An unpriced model would write `0` to
// `ai_usage` on every turn, the monthly sum would stay at zero, and the cap —
// the one control that stops this feature costing money — would simply never
// trip. Nothing would look wrong until the invoice.
//
// Third use of the pattern `lib/export-view.ts` established and
// `lib/place-view.ts` repeated: make the decision a compile error rather than a
// code review note.
//
// Keys are namespaced `vendor/model` so the vendor is readable at every call
// site. **Role aliases were considered and rejected** — a `FAST` or `SMART`
// indirection hides the one thing most worth seeing, which is which model at
// what cost.

import type { AiPrice, AiUsage, ModelMeta } from './types.js'

/**
 * Prices in **cents per million tokens**, from Anthropic's published rates.
 *
 * Cached reads are about a tenth of input and cache writes about 1.25×, which
 * is the entire reason a 12K trip prefix is affordable to send on every turn.
 * Verify against the current pricing page when adding a model; a stale price
 * here is a stale ledger.
 */
const MODELS = {
  // $5 / $25 per MTok. The model the brief chose, and what chat runs on.
  'anthropic/claude-opus-5': {
    vendor: 'anthropic',
    capability: 'chat',
    context_limit: 1_000_000,
    price: { input: 500, output: 2500, cache_write: 625, cache_read: 50 },
  },
  // $2 / $10 per MTok. Not used today. Present so the cost lever the plan names
  // is a one-string change if measured turns come in above the estimate, rather
  // than a decision that has to be researched again under pressure.
  'anthropic/claude-sonnet-5': {
    vendor: 'anthropic',
    capability: 'chat',
    context_limit: 1_000_000,
    price: { input: 200, output: 1000, cache_write: 250, cache_read: 20 },
  },
} as const satisfies Record<string, ModelMeta>

/**
 * Every model the app knows, derived from the table above.
 *
 * `satisfies` on the literal is what makes both halves true at once: the keys
 * stay exact (so `ModelId` is a union of real names rather than `string`) while
 * every value is still checked against `ModelMeta`.
 */
export type ModelId = keyof typeof MODELS

export const MODEL_IDS = Object.keys(MODELS) as ModelId[]

/** The catalogue, widened to the interface for ordinary reads. */
export const MODEL_CATALOGUE: Record<ModelId, ModelMeta> = MODELS

export function modelMeta(id: ModelId): ModelMeta {
  return MODEL_CATALOGUE[id]
}

export const isModelId = (value: unknown): value is ModelId =>
  typeof value === 'string' && value in MODELS

/** What chat runs on unless `AI_CHAT_MODEL` names something else. */
export const DEFAULT_CHAT_MODEL: ModelId = 'anthropic/claude-sonnet-5'

/**
 * The model id the provider itself expects — our key without the vendor prefix.
 *
 * The prefix exists for us, so a call site says which vendor it is reaching;
 * the API has never heard of it.
 */
export function providerModelId(id: ModelId): string {
  return id.slice(id.indexOf('/') + 1)
}

/**
 * What one turn cost, in cents.
 *
 * Priced here, at write time, and stored — never derived on read. Deriving it
 * later would mean the cap query had to know every historical price, and a rate
 * change would retroactively rewrite what last month cost.
 *
 * Returned unrounded: a single turn is a fraction of a cent, and rounding each
 * one to a whole cent would round most turns to zero and the cap would never
 * move. `ai_usage.cost_cents` is `numeric(12,4)` for exactly this reason.
 */
export function priceUsage(id: ModelId, usage: AiUsage): number {
  const { price } = MODEL_CATALOGUE[id]
  return (
    perMillion(usage.input, price.input) +
    perMillion(usage.output, price.output) +
    perMillion(usage.cache_write, price.cache_write) +
    perMillion(usage.cache_read, price.cache_read)
  )
}

const perMillion = (tokens: number, centsPerMillion: number) =>
  (tokens / 1_000_000) * centsPerMillion

export type { AiPrice }
