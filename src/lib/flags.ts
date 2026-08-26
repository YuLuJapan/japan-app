// Feature flags — read from PostHog, answered from a default when PostHog has
// nothing to say.
//
// The default is the contract. Analytics is optional at runtime here (no
// `VITE_POSTHOG_PROJECT_TOKEN`, and nothing is initialised at all — see
// lib/posthog.ts), flags arrive over the network *after* init, and a phone on
// a train may never receive them. Every one of those is an ordinary state, not
// an error, and in all of them a flag reads as whatever the call site said it
// should be. So a flag can be added to the code before it exists in PostHog,
// and removing it from PostHog can never take a screen down.
//
// What the default does *not* override is an answer: a flag PostHog knows and
// has turned off reads as off, even where the default is `true`. "Not found"
// and "found, off" are different things, and only the first is the default's.
import { useEffect, useRef, useState } from 'react'
import type { FeatureFlagResult } from 'posthog-js'
import posthog, { analyticsEnabled } from './posthog'

/**
 * PostHog's answer for one key, or undefined for "no answer" — the flag is
 * unknown, the flags have not arrived yet, or analytics is switched off.
 *
 * `getFeatureFlagResult` is the one call that carries all three shapes a flag
 * can have (on/off, variant, payload) and reports the read to PostHog, which
 * is what makes experiment results add up. It never throws in normal use, but
 * a flag read sits inside a render: if it ever did, the fallback is a far
 * better outcome than a blank screen.
 */
function readFlag(key: string): FeatureFlagResult | undefined {
  if (!analyticsEnabled) return undefined
  try {
    return posthog.getFeatureFlagResult(key)
  } catch {
    return undefined
  }
}

/** True/false for a flag PostHog knows; the default when it knows nothing. */
export function getBoolean(key: string, fallback: boolean): boolean {
  return readFlag(key)?.enabled ?? fallback
}

/**
 * The variant of a multivariate flag — `'control'`, `'compact'`, whichever
 * name it was given in PostHog — or the default.
 *
 * A flag that is off has no variant to give, so it reads as the default: this
 * answers "which of these?", and "none" is not one of the answers. A string
 * shipped as the flag's JSON payload rather than as a variant name works too,
 * since PostHog offers both and neither is wrong.
 */
export function getString(key: string, fallback: string): string {
  const result = readFlag(key)
  if (!result?.enabled) return fallback
  if (result.variant) return result.variant
  return typeof result.payload === 'string' ? result.payload : fallback
}

/**
 * A number from the flag's payload, or from a variant that spells one.
 *
 * Anything that isn't a finite number — an empty payload, a variant named
 * `'control'`, a payload someone typed as `"12 items"` — is the default. A
 * misconfigured flag must not turn into `NaN` three layers down.
 */
export function getNumber(key: string, fallback: number): number {
  const result = readFlag(key)
  if (!result?.enabled) return fallback
  if (typeof result.payload === 'number' && Number.isFinite(result.payload)) return result.payload
  const fromVariant = result.variant ? Number(result.variant) : Number.NaN
  return Number.isFinite(fromVariant) ? fromVariant : fallback
}

/**
 * The flag's JSON payload — the way to ship a shape rather than a switch.
 *
 * `T` is a claim about what PostHog holds, and nothing here can check it: the
 * payload is typed by whoever edited the flag, in a browser, some months ago.
 * Treat the result as you would a parsed response, and let the default carry
 * the shape the code actually relies on.
 */
export function getJson<T>(key: string, fallback: T): T {
  const result = readFlag(key)
  if (!result?.enabled) return fallback
  return result.payload === undefined || result.payload === null ? fallback : (result.payload as T)
}

// --- the same four, for components -------------------------------------------

/**
 * Flags land *after* the first paint — PostHog fetches them once the client is
 * up — so a component that reads one at render time and never looks again
 * shows the default for the whole session. These re-read on PostHog's
 * `onFeatureFlags` and re-render, which also covers the reload that follows
 * signing in, when who the person is can change what they are shown.
 *
 * The reader is held in a ref so an inline default (`useJsonFlag('x', { a: 1 })`
 * — a new object every render) doesn't resubscribe on every pass. The
 * consequence is that a *changing* default is only picked up on the next flag
 * update, which is the right trade: defaults are constants in practice.
 */
function useFlag<T>(key: string, read: () => T): T {
  const readRef = useRef(read)
  readRef.current = read
  const [value, setValue] = useState<T>(read)

  useEffect(() => {
    // Not in the same tick as the render above: flags can arrive in between.
    const refresh = () => setValue(() => readRef.current())
    refresh()
    if (!analyticsEnabled) return
    return posthog.onFeatureFlags(refresh)
  }, [key])

  return value
}

export const useBooleanFlag = (key: string, fallback: boolean) =>
  useFlag(key, () => getBoolean(key, fallback))

export const useStringFlag = (key: string, fallback: string) =>
  useFlag(key, () => getString(key, fallback))

export const useNumberFlag = (key: string, fallback: number) =>
  useFlag(key, () => getNumber(key, fallback))

export const useJsonFlag = <T>(key: string, fallback: T) =>
  useFlag(key, () => getJson(key, fallback))
