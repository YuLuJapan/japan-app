// Session replay, turned on for a handful of screens and off everywhere else.
//
// PostHog records a *session*, not a screen: `startSessionRecording()` and
// `stopSessionRecording()` are the only granularity there is, and neither is a
// config option — `disable_session_recording` in lib/posthog.ts is what they
// flip. So a scope is something this app has to keep, which is what this file
// is: one allowlist, and one effect that syncs the recorder to it.
//
// **The allowlist is not the protection.** Two things make it leaky on its
// own. `startSessionRecording()` takes a full DOM snapshot of whatever is on
// screen at that moment, and the stop on the way out runs in an effect — after
// React has rendered the next screen and rrweb's observer has seen it. Both
// windows are small and neither is closeable from here. What makes them
// survivable is the masking in `posthogOptions.session_recording`: every text
// node is masked everywhere, on the recorded screens too, so the worst a slip
// can capture is a layout. Read the two together or not at all — deleting
// `maskTextSelector` turns this file into a leak with a delay on it.
//
// What a masked replay is still good for is the reason this exists: field
// order, focus order, where a thumb stalls, a rage click, the tap that goes
// nowhere. What it deliberately cannot show is a word of trip content.
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useBooleanFlag } from './flags'
import posthog, { analyticsEnabled } from './posthog'

/** Rollout control, defaulting off — the `export-trip` / `show-map` idiom. */
export const REPLAY_FLAG = 'session-replay'

/**
 * The screens that may be recorded. Everything else is refused by omission,
 * which is the direction a list like this has to fail in: a route added to the
 * router tomorrow is not recorded until somebody writes it down here.
 *
 * What is on it and why:
 * - `/trips` — the trips list and the add/edit trip sheet on top of it. This is
 *   the create-trip flow, and it is the one screen here anybody wants to watch.
 * - `/terms`, `/privacy` — the documents. Static text, no account needed.
 * - `…/essentials` — the static advice tab. Written into the bundle, not typed
 *   by a traveller (src/pages/TripEssentials.tsx).
 *
 * What is deliberately *not* on it, beyond "everything else":
 * - `/gate`. It is the obvious funnel to want, and it is the one screen whose
 *   URL carries a credential: Supabase hands the magic link back as a token in
 *   the location (a `#access_token` fragment, or a `?code=` under PKCE), and a
 *   replay records the URL. Masking does not reach a URL. A sign-in funnel is
 *   not worth a live token in an analytics tool.
 * - `/invite/:token`, for exactly the same reason — the token *is* the path.
 * - Anything else under `/trips/:tripId`. The trip home alone renders the
 *   flight's booking reference as text (components/CountdownWidget.tsx), and
 *   past it lie the stays, the documents and the shopping list.
 */
const RECORDABLE = [
  /^\/trips\/?$/,
  /^\/terms\/?$/,
  /^\/privacy\/?$/,
  /^\/trips\/[^/]+\/essentials\/?$/,
]

/** Whether this path is one of the few. Pure, and exported for its own tests. */
export function shouldRecord(pathname: string): boolean {
  return RECORDABLE.some((pattern) => pattern.test(pathname))
}

/**
 * What we have asked the recorder for, which is not the same as what it is
 * doing: with session replay switched off for the project, or the remote
 * config not yet arrived, `startSessionRecording()` is a request PostHog is
 * free to decline. Tracking the intent rather than reading `posthog` back
 * keeps this idempotent either way — a navigation between two recorded screens
 * must not restart the recorder, since a restart is a fresh snapshot.
 */
let asked = false

/**
 * Point the recorder at the current screen. Safe to call on every navigation.
 *
 * Nothing happens at all when analytics is off — there is no client to call
 * into — which is also what makes local dev, CI and a deploy without
 * `VITE_POSTHOG_PROJECT_TOKEN` behave exactly as they did before this existed.
 */
export function syncSessionReplay(enabled: boolean, pathname: string) {
  if (!analyticsEnabled) return
  const wanted = enabled && shouldRecord(pathname)
  if (wanted === asked) return
  asked = wanted
  if (wanted) posthog.startSessionRecording()
  else posthog.stopSessionRecording()
}

/**
 * Mounted once, above the whole router (src/router.tsx).
 *
 * The flag is read with the hook rather than the getter for the usual reason:
 * flags land after the first paint, so a plain read would answer `false` for
 * the whole session and the feature would look broken wherever it was turned
 * on. Re-running on the flag *and* the path is what lets a rollout reach a tab
 * that is already open — and, more to the point, lets a rollback stop a
 * recorder that is already running.
 */
export function useSessionReplayScope() {
  const enabled = useBooleanFlag(REPLAY_FLAG, false)
  const { pathname } = useLocation()

  useEffect(() => {
    syncSessionReplay(enabled, pathname)
  }, [enabled, pathname])
}

/** Test seam: forget what we last asked for. Not used by the app. */
export function resetSessionReplayForTests() {
  asked = false
}
