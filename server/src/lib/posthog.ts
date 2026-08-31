// PostHog, server side.
//
// Distinct from `src/lib/posthog.ts` in the browser, and it exists for two
// things the browser cannot do: report what a model call cost, and answer a
// feature flag where the *server* can act on it. A `posthog-js` flag is
// evaluated in the browser and can only hide a button; anything that has to
// hold on the server — which model to run, how much may be spent — has to be
// asked for from here.
//
// Optional at runtime, exactly like push with no VAPID keys and the browser's
// analytics with no token: no key means every caller no-ops and nothing is
// sent. That is a supported state, not a degraded one.

import { PostHog } from 'posthog-node'

let client: PostHog | null | undefined

/**
 * The server-side client, or null when nothing is configured.
 *
 * Reads the server-only name first and falls back to the browser's, because on
 * Vercel they are the same project token and requiring it twice is a trap:
 * somebody sets one, the flags read as unanswered, and the defaults look like a
 * bug.
 */
export function getPostHog(): PostHog | null {
  if (client !== undefined) return client

  const key = process.env.POSTHOG_PROJECT_API_KEY ?? process.env.VITE_POSTHOG_PROJECT_TOKEN
  if (!key) {
    client = null
    return client
  }

  client = new PostHog(key, {
    host: process.env.POSTHOG_HOST ?? process.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    // A serverless function can be frozen the moment its response is sent, so
    // an event sitting in a batch is an event that never arrives. One at a
    // time, immediately — the volume here is one per chat turn, not per
    // request, so there is nothing to gain from batching anyway.
    flushAt: 1,
    flushInterval: 0,
  })
  return client
}

/**
 * Test seam, the same idiom as `setDataStore` and `setAiRuntime`.
 *
 * `null` means "configured as absent"; `undefined` restores reading the env.
 */
export function setPostHog(next: PostHog | null | undefined): void {
  client = next
}

/**
 * Read feature flags for one account, in a single request.
 *
 * Returns `null` when PostHog is unreachable, unconfigured, or slow — every one
 * of which is an ordinary state, and all of which the caller must answer the
 * same way: **use the default**. That is what makes a flag safe to read on a
 * path that costs money. A cap that failed open because a network call timed out
 * would be the worst possible failure of the one control that stops this
 * spending.
 *
 * Never throws.
 */
export async function readServerFlags(
  distinctId: string,
  flagKeys: string[]
): Promise<FlagSnapshot | null> {
  const posthog = getPostHog()
  if (!posthog) return null

  try {
    // `flagKeys` scopes the request to what we actually branch on, rather than
    // fetching every flag in the project on the chat path.
    const flags = await posthog.evaluateFlags(distinctId, { flagKeys })
    return {
      value: (key) => flags.getFlag(key),
      payload: (key) => flags.getFlagPayload(key),
    }
  } catch (err) {
    // A flag read must never be able to fail a request. Logged, not raised.
    console.error('[posthog] flag read failed, using defaults', err)
    return null
  }
}

export interface FlagSnapshot {
  value(key: string): string | boolean | undefined
  payload(key: string): unknown
}
