// Product analytics — optional at runtime, like push.
//
// Analytics is configuration, not a dependency: with no VITE_POSTHOG_KEY the
// helpers below are no-ops and the app behaves exactly as it did before this
// file existed. The wizard's generated version instead *threw* on a missing
// key in DEV, which blanked the app on `npm run dev` and took the whole web
// test suite down with it (the throw runs at module load, so every module that
// transitively imports this one fails to evaluate). A missing key is a
// perfectly ordinary state — a fresh clone, a preview deploy, CI — so it is
// handled rather than fatal.
import posthog from 'posthog-js'
import type { PostHogConfig } from 'posthog-js'

/** The public project token, or null when analytics is switched off. */
export const posthogKey = import.meta.env.VITE_POSTHOG_KEY || null

/** True when `posthog.init` has actually run, so calls are worth making. */
export const analyticsEnabled = Boolean(posthogKey)

export const posthogOptions: Partial<PostHogConfig> = {
  api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',

  // Without this, `capture_pageview` keeps its legacy meaning — "once, on page
  // load" — which in a `createBrowserRouter` SPA means one $pageview per cold
  // start and nothing at all for the navigation that follows. From '2025-05-24'
  // onwards it means 'history_change', i.e. a $pageview per route change, which
  // is the whole point of asking for screen-level behaviour.
  defaults: '2026-05-30',

  // Deliberately off. Autocapture ships the text of whatever was clicked, and
  // in this app that text is the trip's private content: reservation details on
  // a hotel place, and the shopping list — where an item *is* the secret (the
  // presents), which is why a viewer can be cut off from the category wholesale
  // (lib/trip-view.ts). The named events this app captures carry ids and shapes,
  // never trip content, and are far easier to read than a wall of $autocapture.
  autocapture: false,
  disable_session_recording: true,

  capture_exceptions: {
    capture_unhandled_errors: true,
    capture_unhandled_rejections: true,
    capture_console_errors: false,
  },
}

/**
 * Record a product event.
 *
 * Properties should describe the *shape* of what happened — a category, a
 * count, a kind — never trip content. See `posthogOptions.autocapture`.
 */
export function capture(event: string, properties?: Record<string, unknown>) {
  if (!analyticsEnabled) return
  posthog.capture(event, properties)
}

/** Attach subsequent events to a signed-in account. */
export function identify(distinctId: string, personProperties?: Record<string, unknown>) {
  if (!analyticsEnabled) return
  posthog.identify(distinctId, personProperties)
}

/** Drop the identity on sign-out, so the next person on this device is not them. */
export function reset() {
  if (!analyticsEnabled) return
  posthog.reset()
}

export default posthog
