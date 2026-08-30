// The model catalogue, and what it costs.
//
// Note what this file *cannot* test, and why it says so out loud: the guard
// that matters most — a model reaching the runtime without a price — is a
// **type** error, and vitest transpiles types away. Deleting `cache_read` from
// a price fails `npm run typecheck` and passes every test here. That is why
// typecheck is part of this feature's gate rather than a nicety (FR-028,
// research R9); these tests cover the arithmetic the type system cannot.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_MODEL,
  MODEL_CATALOGUE,
  MODEL_IDS,
  isModelId,
  modelMeta,
  priceUsage,
  providerModelId,
} from '../src/lib/ai/models.js'
import { AI_CAPABILITIES, AI_VENDORS } from '../src/lib/ai/types.js'
import type { AiUsage } from '../src/lib/ai/types.js'

describe('the catalogue', () => {
  it('prices every model on all four token kinds', () => {
    for (const id of MODEL_IDS) {
      const { price } = modelMeta(id)
      for (const kind of ['input', 'output', 'cache_write', 'cache_read'] as const) {
        expect(price[kind], `${id}.price.${kind}`).toBeGreaterThan(0)
      }
    }
  })

  it('gives every model a vendor, a capability and a context limit', () => {
    for (const id of MODEL_IDS) {
      const meta = modelMeta(id)
      expect(AI_VENDORS).toContain(meta.vendor)
      expect(AI_CAPABILITIES).toContain(meta.capability)
      expect(meta.context_limit).toBeGreaterThan(0)
    }
  })

  it('namespaces every key by its own vendor', () => {
    // The prefix is what makes a call site say which vendor it is reaching. A
    // key whose prefix disagreed with its `vendor` would read as a lie at every
    // one of those call sites.
    for (const id of MODEL_IDS) {
      expect(id.startsWith(`${modelMeta(id).vendor}/`), id).toBe(true)
    }
  })

  it('offers a default chat model that is in the catalogue and can chat', () => {
    expect(MODEL_IDS).toContain(DEFAULT_CHAT_MODEL)
    expect(modelMeta(DEFAULT_CHAT_MODEL).capability).toBe('chat')
  })

  it('recognises its own ids and nothing else', () => {
    expect(isModelId(DEFAULT_CHAT_MODEL)).toBe(true)
    expect(isModelId('anthropic/claude-does-not-exist')).toBe(false)
    // The bare provider name is the shape a hand-written env var most easily
    // takes, and it must not be accepted — it would resolve to no price.
    expect(isModelId('claude-opus-5')).toBe(false)
    expect(isModelId(undefined)).toBe(false)
  })

  it('strips the namespace for the provider, which has never heard of it', () => {
    expect(providerModelId('anthropic/claude-opus-5')).toBe('claude-opus-5')
  })
})

describe('pricing a turn', () => {
  const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
    input: 0,
    output: 0,
    cache_write: 0,
    cache_read: 0,
    ...over,
  })

  it('charges each token kind at its own rate', () => {
    // 1M input on Opus 5 is $5.00 = 500 cents, by the table.
    expect(priceUsage('anthropic/claude-opus-5', usage({ input: 1_000_000 }))).toBeCloseTo(500, 6)
    expect(priceUsage('anthropic/claude-opus-5', usage({ output: 1_000_000 }))).toBeCloseTo(2500, 6)
  })

  it('charges a cached read at a tenth of an uncached one', () => {
    const cold = priceUsage('anthropic/claude-opus-5', usage({ input: 12_000 }))
    const warm = priceUsage('anthropic/claude-opus-5', usage({ cache_read: 12_000 }))
    // This ratio is the whole reason a 12K trip prefix is affordable to send on
    // every turn. If it ever stops holding, the cost model in plan.md is wrong.
    expect(cold / warm).toBeCloseTo(10, 6)
  })

  it('does not round a turn away', () => {
    // A short warm turn — "what time is the flight?" — costs well under a
    // cent, almost all of it the cached prefix. Rounding each turn to a whole
    // cent would floor these to zero, the monthly sum would never move, and
    // the cap would silently stop working. `ai_usage.cost_cents` is
    // numeric(12,4) for exactly this reason.
    const short = priceUsage(
      'anthropic/claude-opus-5',
      usage({ input: 50, output: 30, cache_read: 11_840 })
    )
    expect(short).toBeGreaterThan(0)
    expect(short).toBeLessThan(1)
    // What an integer cents column would have stored: nothing at all.
    expect(Math.trunc(short)).toBe(0)
  })

  it('keeps sub-cent precision on an ordinary turn', () => {
    // A longer answer runs to a cent or two, and the fraction still matters:
    // rounded to whole cents this loses a fifth of itself, every turn.
    const ordinary = priceUsage(
      'anthropic/claude-opus-5',
      usage({ input: 420, output: 180, cache_read: 11_840 })
    )
    expect(ordinary).toBeCloseTo(1.252, 6)
    expect(Number.isInteger(ordinary)).toBe(false)
  })

  it('prices a turn with no usage at nothing', () => {
    expect(priceUsage('anthropic/claude-opus-5', usage())).toBe(0)
  })

  it('costs a cold turn several times a warm one', () => {
    const shape = { output: 800 }
    const warm = priceUsage('anthropic/claude-opus-5', usage({ ...shape, cache_read: 12_000 }))
    const cold = priceUsage('anthropic/claude-opus-5', usage({ ...shape, input: 12_000 }))
    // plan.md quotes ~$0.026 warm against ~$0.080 cold. The exact figures are
    // arithmetic until SC-007 replaces them with measurement; what is asserted
    // here is the relationship the whole cache argument rests on.
    expect(cold).toBeGreaterThan(warm * 2)
  })

  it('prices the cheaper model below the default on identical usage', () => {
    const shape = usage({ input: 12_000, output: 800 })
    expect(priceUsage('anthropic/claude-sonnet-5', shape)).toBeLessThan(
      priceUsage('anthropic/claude-opus-5', shape)
    )
  })
})

describe('the catalogue as a record', () => {
  it('exposes exactly the ids it lists', () => {
    expect(Object.keys(MODEL_CATALOGUE).sort()).toEqual([...MODEL_IDS].sort())
  })
})
