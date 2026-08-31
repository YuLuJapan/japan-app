// Model and cap, as feature flags.
//
// What is asserted here is almost entirely the **fallback**, because that is
// where the safety lives. PostHog being unreachable, unconfigured, slow, or
// simply not knowing a key are all ordinary states, and every one of them has to
// land on the value the code shipped with. A cap that failed open because a
// network call timed out would be the worst possible failure of the one control
// that stops this spending.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAP_FLAG, MODEL_FLAG, aiSettings } from '../src/lib/ai/settings.js'
import { DEFAULT_CHAT_MODEL } from '../src/lib/ai/models.js'
import { setPostHog } from '../src/lib/posthog.js'

/** A PostHog stand-in answering a fixed set of flags. */
function withFlags(values: Record<string, unknown>, payloads: Record<string, unknown> = {}) {
  setPostHog({
    evaluateFlags: async () => ({
      getFlag: (key: string) => values[key],
      getFlagPayload: (key: string) => payloads[key],
    }),
  } as never)
}

/** PostHog configured but failing — a timeout, a 500, a network blip. */
function withBrokenPostHog() {
  setPostHog({
    evaluateFlags: async () => {
      throw new Error('unreachable')
    },
  } as never)
}

beforeEach(() => {
  setPostHog(null)
  delete process.env.AI_MONTHLY_CAP_CENTS
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  setPostHog(undefined)
  delete process.env.AI_MONTHLY_CAP_CENTS
  vi.restoreAllMocks()
})

describe('with no PostHog configured', () => {
  it('uses the built-in model and the env cap', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '2500'
    expect(await aiSettings('user-1')).toEqual({
      model: DEFAULT_CHAT_MODEL,
      monthlyCapCents: 2500,
    })
  })

  it('falls all the way to the default cap when the env is unset too', async () => {
    expect((await aiSettings('user-1')).monthlyCapCents).toBe(1000)
  })
})

describe('when PostHog answers', () => {
  it('takes the model from a variant name', async () => {
    withFlags({ [MODEL_FLAG]: 'anthropic/claude-sonnet-5' })
    expect((await aiSettings('user-1')).model).toBe('anthropic/claude-sonnet-5')
  })

  it('takes the model from a string payload too', async () => {
    // A model id contains a slash, which is awkward as a variant name — so both
    // shapes are read rather than forcing one.
    withFlags({}, { [MODEL_FLAG]: 'anthropic/claude-sonnet-5' })
    expect((await aiSettings('user-1')).model).toBe('anthropic/claude-sonnet-5')
  })

  it('takes the cap from a number payload', async () => {
    withFlags({}, { [CAP_FLAG]: 250 })
    expect((await aiSettings('user-1')).monthlyCapCents).toBe(250)
  })

  it('reads a numeric string payload, which is what a JSON field often holds', async () => {
    withFlags({}, { [CAP_FLAG]: '250' })
    expect((await aiSettings('user-1')).monthlyCapCents).toBe(250)
  })

  it('lets the cap be lowered to zero, which blocks everyone', async () => {
    // A deliberate emergency stop has to be expressible. Zero is a cap, not a
    // missing value, so it must not fall back.
    withFlags({}, { [CAP_FLAG]: 0 })
    expect((await aiSettings('user-1')).monthlyCapCents).toBe(0)
  })
})

describe('a flag that cannot be honoured', () => {
  it('ignores a model that is not in the catalogue', async () => {
    // The guard that matters: a typo in PostHog must not reach the runtime as a
    // model with no price, which would write 0 to the ledger and stop the cap
    // working. A flag may pick from the catalogue; it may not extend it.
    withFlags({ [MODEL_FLAG]: 'anthropic/claude-does-not-exist' })
    expect((await aiSettings('user-1')).model).toBe(DEFAULT_CHAT_MODEL)
  })

  it('ignores a bare provider name that names no catalogue entry', async () => {
    withFlags({ [MODEL_FLAG]: 'claude-opus-5' })
    expect((await aiSettings('user-1')).model).toBe(DEFAULT_CHAT_MODEL)
  })

  it('ignores a boolean-on flag, which names no model at all', async () => {
    withFlags({ [MODEL_FLAG]: true })
    expect((await aiSettings('user-1')).model).toBe(DEFAULT_CHAT_MODEL)
  })

  it('ignores a cap that is not a number', async () => {
    // Never NaN: every comparison against NaN is false, so `spent >= cap` would
    // be false forever and a bad flag would silently disable the cap.
    process.env.AI_MONTHLY_CAP_CENTS = '1500'
    withFlags({}, { [CAP_FLAG]: 'lots' })
    expect((await aiSettings('user-1')).monthlyCapCents).toBe(1500)
  })

  it('ignores a negative cap', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1500'
    withFlags({}, { [CAP_FLAG]: -1 })
    expect((await aiSettings('user-1')).monthlyCapCents).toBe(1500)
  })
})

describe('when PostHog is unreachable', () => {
  it('falls back rather than failing the turn', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1500'
    withBrokenPostHog()
    expect(await aiSettings('user-1')).toEqual({
      model: DEFAULT_CHAT_MODEL,
      monthlyCapCents: 1500,
    })
  })
})
