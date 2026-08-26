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
//
// What may be sent is decided in lib/analytics-events.ts, not here: that file
// holds the event names (which type `capture`) and the value guard every
// property passes through on the way out.
import posthog from 'posthog-js'
import type { PostHogConfig } from 'posthog-js'
import { ApiError } from '../api/client'
import type { Trip, TripRole } from '../api/types'
import {
  TRIP_CONTEXT_KEYS,
  sanitizeProperties,
  type AnalyticsEvent,
  type AnalyticsEventProperties,
  type TripContextProperties,
  type TripFacts,
} from './analytics-events'
import { isJapanTrip } from './destination'

/**
 * The public project token, or null when analytics is switched off.
 *
 * Two names are accepted because two sources disagree: PostHog's own docs use
 * VITE_POSTHOG_PROJECT_TOKEN, while its setup wizard writes VITE_POSTHOG_KEY.
 * Reading only one of them fails in the worst possible way — the app runs
 * perfectly and simply never sends an event — so both work, docs name first.
 */
export const posthogKey =
  import.meta.env.VITE_POSTHOG_PROJECT_TOKEN || import.meta.env.VITE_POSTHOG_KEY || null

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

// Being switched off is legitimate, so this is not an error — but silence is
// exactly how a misnamed env var goes unnoticed (it did once already), so say
// so where a developer will see it. Never in production: it is normal there.
if (!analyticsEnabled && import.meta.env.DEV) {
  console.warn(
    '[analytics] PostHog is off: no VITE_POSTHOG_PROJECT_TOKEN (or VITE_POSTHOG_KEY). No events will be sent.'
  )
}

/**
 * Run the properties past the guard, and complain where a developer will see
 * it. Never throws: a rejected property must not take a save down with it.
 */
function clean(label: string, properties: Record<string, unknown>) {
  const { properties: safe, problems } = sanitizeProperties(properties)
  if (problems.length && import.meta.env.DEV) {
    console.warn(`[analytics] ${label}:\n  ${problems.join('\n  ')}`)
  }
  return safe
}

type PropertiesOf<E extends AnalyticsEvent> = AnalyticsEventProperties[E]

/**
 * Record a product event.
 *
 * The name must be one of the events in lib/analytics-events.ts and the
 * properties must match the shape declared there — an event nobody declared,
 * or one missing the property a chart is grouped by, is a compile error here
 * rather than a gap discovered weeks later in PostHog.
 *
 * Properties describe the *shape* of what happened — a category, a count, a
 * kind — never trip content; `sanitizeProperties` enforces that at runtime.
 */
export function capture<E extends AnalyticsEvent>(
  event: E,
  ...rest: PropertiesOf<E> extends undefined ? [] : [properties: PropertiesOf<E>]
) {
  if (!analyticsEnabled) return
  const properties = (rest as unknown[])[0] as Record<string, unknown> | undefined
  if (!properties) {
    posthog.capture(event)
    return
  }
  posthog.capture(event, clean(event, properties))
}

/** Attach subsequent events to a signed-in account. */
export function identify(distinctId: string, personProperties?: Record<string, unknown>) {
  if (!analyticsEnabled) return
  // Person properties are the one place an email belongs — it is how a report
  // is traced back to the account that filed it — so they skip the guard.
  posthog.identify(distinctId, personProperties)
}

/** Drop the identity on sign-out, so the next person on this device is not them. */
export function reset() {
  if (!analyticsEnabled) return
  posthog.reset()
}

// --- trip context ------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Whole days from `start_date` to `end_date` inclusive; 0 for unparseable dates. */
function lengthInDays(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`)
  const to = Date.parse(`${end}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.max(0, Math.round((to - from) / MS_PER_DAY) + 1)
}

/** Planning it, on it, or back from it — by the reader's own calendar day. */
function phaseOf(trip: Trip, today: string): TripFacts['trip_phase'] {
  if (trip.end_date && trip.end_date < today) return 'past'
  if (trip.start_date && trip.start_date > today) return 'upcoming'
  return 'active'
}

/** Today as YYYY-MM-DD in the reader's own zone — the phone is where they are. */
const localToday = (now: Date) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

/**
 * The shape of a trip, with nothing that identifies it.
 *
 * Pure and exported for its own tests. The country is lower-cased so that
 * 'Japan' and 'japan ' land in one group — it is free text on the trip sheet,
 * not a code, and an ungrouped dimension is no dimension at all.
 */
export function tripFacts(trip: Trip, now: Date = new Date()): TripFacts {
  const country = trip.country?.trim().toLowerCase() || null
  return {
    trip_country: country,
    trip_destination: isJapanTrip(trip.country) ? 'japan' : country ? 'other' : 'unknown',
    trip_length_days: lengthInDays(trip.start_date, trip.end_date),
    trip_travellers: trip.people?.length ?? 0,
    trip_local_currency: trip.local_currency,
    trip_phase: phaseOf(trip, localToday(now)),
  }
}

/** The same, plus which trip and what this caller may do on it. */
export function tripContext(
  trip: Trip,
  role: TripRole | null | undefined,
  now: Date = new Date()
): TripContextProperties {
  return { ...tripFacts(trip, now), trip_id: trip.id, trip_role: role ?? null }
}

/**
 * Carry the open trip on every subsequent event, or clear it on the way out.
 *
 * Registered as super properties rather than passed at each call site: an
 * event that had to remember to say which trip it was on would forget, and
 * `$pageview` — sent by PostHog itself — could never say it at all. Clearing
 * is exhaustive over TRIP_CONTEXT_KEYS, because a stale country on the trips
 * list is worse than none.
 */
export function setTripContext(context: TripContextProperties | null) {
  if (!analyticsEnabled) return
  if (!context) {
    for (const key of TRIP_CONTEXT_KEYS) posthog.unregister(key)
    return
  }
  posthog.register(clean('trip context', context))
}

// --- errors ------------------------------------------------------------------

/** Where a failure was noticed. Unhandled crashes arrive on their own. */
export type ErrorSource = 'query' | 'mutation' | 'push' | 'auth'

/**
 * Ids differ per trip and per place, so a path with them in it is a group of
 * one and the chart of "what is failing in production" never rises above the
 * noise. Every id-shaped segment becomes `:id`, leaving the *route*.
 */
export function scrubPath(path: string): string {
  return path
    .split('?')[0]
    .split('/')
    .map((segment) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) || /^[A-Za-z0-9_-]{16,}$/.test(segment)
        ? ':id'
        : segment
    )
    .join('/')
}

/**
 * What is worth knowing about a failure, and nothing else.
 *
 * Deliberately no message: a validation message names the rule that was broken
 * ("day must be within the trip") and is safe, but a server 500 can carry
 * anything at all, and telling the two apart at this point is guesswork. The
 * code and the route are what a fix starts from.
 */
export function errorProperties(error: unknown, source: ErrorSource): Record<string, unknown> {
  const base: Record<string, unknown> = { source, offline: !navigator.onLine }
  if (error instanceof ApiError) {
    return {
      ...base,
      status: error.status,
      code: error.code,
      method: error.method ?? null,
      path: error.path ? scrubPath(error.path) : null,
      // status 0 is this app's own marker for "the fetch never left the phone",
      // which on a trip usually means a tunnel rather than a bug.
      network: error.status === 0,
    }
  }
  return { ...base, status: null, code: error instanceof Error ? error.name : 'UNKNOWN' }
}

/**
 * Report a failure that the app handled — a save that came back 500, a query
 * that gave up — so production problems surface without someone reporting them.
 *
 * Unhandled errors and render crashes are already covered (`capture_exceptions`
 * plus `PostHogErrorBoundary` in main.tsx); these are the ones the app catches
 * and turns into a toast, which is exactly why they would otherwise be invisible.
 */
export function captureError(error: unknown, source: ErrorSource, extra?: Record<string, unknown>) {
  if (!analyticsEnabled) return
  const properties = clean('error report', { ...errorProperties(error, source), ...extra })
  posthog.captureException(reportable(error), properties)
}

/**
 * The error to hand PostHog — which is not always the one that was thrown.
 *
 * `captureException` sends the message and the stack, and an `ApiError`'s
 * message is the *server's*: safe for a validation rule, anyone's guess for a
 * 500, and its stack is only ever this app's fetch wrapper. So a request
 * failure is reported as a line built from the parts already known to be safe
 * — which has the happy side effect of grouping every instance of one failing
 * route together, instead of once per wording. A genuine JS error is passed
 * through untouched: there the message and the stack are the whole report.
 */
function reportable(error: unknown): Error {
  if (error instanceof ApiError) {
    const route = error.path ? `${error.method ?? ''} ${scrubPath(error.path)}`.trim() : 'no route'
    const reported = new Error(`${error.status} ${error.code} (${route})`)
    reported.name = 'ApiError'
    return reported
  }
  return error instanceof Error ? error : new Error('Non-Error thrown')
}

export default posthog
