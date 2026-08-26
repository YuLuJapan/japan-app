// Feature flags are read inside renders, on phones that may never receive
// them, in builds where analytics is switched off entirely. The contract that
// matters is therefore the boring one: the call site's default is what comes
// back whenever PostHog has no answer — and *only* then, because a flag
// somebody has deliberately turned off is an answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { FeatureFlagResult } from 'posthog-js'

const state = vi.hoisted(() => ({
  enabled: true,
  /** What the fake PostHog answers for any key. */
  answer: undefined as FeatureFlagResult | undefined,
  throws: false,
  handlers: [] as (() => void)[],
  reads: 0,
  subscribes: 0,
  unsubscribes: 0,
}))

// The real module is covered by analytics.test.ts; what is under test here is
// what flags.ts does with the answers, including "analytics is off".
vi.mock('../lib/posthog', () => ({
  default: {
    getFeatureFlagResult: () => {
      state.reads += 1
      if (state.throws) throw new Error('flags are not loaded')
      return state.answer
    },
    onFeatureFlags: (callback: () => void) => {
      state.subscribes += 1
      state.handlers.push(callback)
      return () => {
        state.unsubscribes += 1
        state.handlers = state.handlers.filter((handler) => handler !== callback)
      }
    },
  },
  get analyticsEnabled() {
    return state.enabled
  },
}))

const { getBoolean, getJson, getNumber, getString, useBooleanFlag, useJsonFlag } =
  await import('../lib/flags')

/** A flag PostHog knows about. `undefined` overall is a flag it does not. */
const answer = (over: Partial<FeatureFlagResult> = {}): FeatureFlagResult => ({
  key: 'trip-timeline',
  enabled: true,
  variant: undefined,
  payload: undefined,
  ...over,
})

beforeEach(() => {
  state.enabled = true
  state.answer = undefined
  state.throws = false
  state.handlers = []
  state.reads = 0
  state.subscribes = 0
  state.unsubscribes = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('with analytics switched off', () => {
  beforeEach(() => {
    state.enabled = false
    state.answer = answer({ enabled: true, variant: 'compact', payload: 42 })
  })

  it('answers every flag from its default', () => {
    expect(getBoolean('trip-timeline', true)).toBe(true)
    expect(getBoolean('trip-timeline', false)).toBe(false)
    expect(getString('trip-timeline', 'classic')).toBe('classic')
    expect(getNumber('trip-timeline', 7)).toBe(7)
    expect(getJson('trip-timeline', { rows: 3 })).toEqual({ rows: 3 })
  })

  it('never calls into an uninitialised client', () => {
    getBoolean('trip-timeline', false)
    getJson('trip-timeline', null)
    expect(state.reads).toBe(0)
  })
})

describe('a flag PostHog has no answer for', () => {
  it('reads as its default — the flag may not exist yet, or may never arrive', () => {
    state.answer = undefined
    expect(getBoolean('unknown', true)).toBe(true)
    expect(getString('unknown', 'classic')).toBe('classic')
    expect(getNumber('unknown', 7)).toBe(7)
    expect(getJson('unknown', { rows: 3 })).toEqual({ rows: 3 })
  })

  it('reads as its default when the client throws rather than answers', () => {
    // A flag read sits inside a render. Whatever happens, it returns.
    state.throws = true
    expect(getBoolean('trip-timeline', true)).toBe(true)
    expect(getString('trip-timeline', 'classic')).toBe('classic')
  })
})

describe('getBoolean', () => {
  it('is on when the flag is on', () => {
    state.answer = answer({ enabled: true })
    expect(getBoolean('trip-timeline', false)).toBe(true)
  })

  it('is off when the flag is off, even where the default says otherwise', () => {
    // The whole point of a kill switch: turning it off in PostHog has to beat
    // the `true` written at the call site, or nothing could ever be turned off.
    state.answer = answer({ enabled: false })
    expect(getBoolean('trip-timeline', true)).toBe(false)
  })
})

describe('getString', () => {
  it('is the variant of a multivariate flag', () => {
    state.answer = answer({ variant: 'compact' })
    expect(getString('trip-timeline', 'classic')).toBe('compact')
  })

  it('accepts a string shipped as the payload instead — PostHog offers both', () => {
    state.answer = answer({ payload: 'compact' })
    expect(getString('trip-timeline', 'classic')).toBe('compact')
  })

  it('is the default for a plain on/off flag, which has no variant to give', () => {
    state.answer = answer({ enabled: true })
    expect(getString('trip-timeline', 'classic')).toBe('classic')
  })

  it('is the default when the flag is off — "none" is not one of the answers', () => {
    state.answer = answer({ enabled: false, variant: 'compact' })
    expect(getString('trip-timeline', 'classic')).toBe('classic')
  })
})

describe('getNumber', () => {
  it('reads a number from the payload', () => {
    state.answer = answer({ payload: 12 })
    expect(getNumber('trip-timeline', 7)).toBe(12)
  })

  it('reads one from a variant that spells a number', () => {
    state.answer = answer({ variant: '12' })
    expect(getNumber('trip-timeline', 7)).toBe(12)
  })

  it('is the default for anything that is not a number', () => {
    // A misconfigured flag must not become NaN three layers down.
    state.answer = answer({ variant: 'control' })
    expect(getNumber('trip-timeline', 7)).toBe(7)
    state.answer = answer({ payload: '12 items' })
    expect(getNumber('trip-timeline', 7)).toBe(7)
  })
})

describe('getJson', () => {
  it('is the payload', () => {
    state.answer = answer({ payload: { rows: 5, dense: true } })
    expect(getJson('trip-timeline', { rows: 3, dense: false })).toEqual({ rows: 5, dense: true })
  })

  it('is the default when the flag carries no payload', () => {
    state.answer = answer({ enabled: true, payload: null })
    expect(getJson('trip-timeline', { rows: 3 })).toEqual({ rows: 3 })
  })

  it('is the default when the flag is off, payload or not', () => {
    state.answer = answer({ enabled: false, payload: { rows: 5 } })
    expect(getJson('trip-timeline', { rows: 3 })).toEqual({ rows: 3 })
  })
})

describe('the hooks', () => {
  it('start on the default and re-render when the flags land', () => {
    // The case a plain read cannot cover: PostHog fetches flags after the
    // first paint, so a component that reads once shows the default all
    // session and the flag looks broken.
    const { result } = renderHook(() => useBooleanFlag('trip-timeline', false))
    expect(result.current).toBe(false)

    state.answer = answer({ enabled: true })
    act(() => state.handlers.forEach((handler) => handler()))
    expect(result.current).toBe(true)
  })

  it('stop listening when the component goes', () => {
    const { unmount } = renderHook(() => useBooleanFlag('trip-timeline', false))
    expect(state.subscribes).toBe(1)
    unmount()
    expect(state.unsubscribes).toBe(1)
    expect(state.handlers).toHaveLength(0)
  })

  it('do not resubscribe when the default is written inline', () => {
    // `useJsonFlag('x', { rows: 3 })` is a new object every render. Held in a
    // ref rather than a dependency, so this stays one subscription.
    const { rerender } = renderHook(() => useJsonFlag('trip-timeline', { rows: 3 }))
    rerender()
    rerender()
    expect(state.subscribes).toBe(1)
  })

  it('subscribe to nothing when analytics is off', () => {
    state.enabled = false
    const { result } = renderHook(() => useBooleanFlag('trip-timeline', true))
    expect(result.current).toBe(true)
    expect(state.subscribes).toBe(0)
  })
})
