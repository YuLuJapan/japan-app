// Who is holding the phone, and what this trip shows them.
//
// There is one kind of caller now: a signed-in account. The app used to also
// carry a *global* role, because a shared access code reached every trip and
// "may you write?" had a single answer for the whole app. Both codes are gone,
// so the question is per trip and the answer rides on the bundle each screen
// has already fetched — `my_role` for the verbs, `shows` for the content.
//
// None of this is load-bearing for safety. The server independently refuses
// every write a viewer attempts and withholds whatever their membership says
// they may not see; this exists so nobody is offered a button that would fail,
// or shown an empty list where the honest answer is "not shared with you".
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { clearAccessCode, setAccessCode } from '../api/client'
import type { TripRole, TripShows } from '../api/types'
import { capture, identify } from './posthog'
import { getSupabaseClient } from './supabaseClient'

/**
 * The caller's role on the trip currently open, or null outside one. Read from
 * the trip bundle the screen has already fetched, so this costs no request.
 */
const TripRoleContext = createContext<TripRole | null>(null)
export const useTripRole = () => useContext(TripRoleContext)
export { TripRoleContext }

/** Everything is shown until a bundle says otherwise — outside a trip there is
 *  nothing withheld, and a writer's flags are ignored server-side anyway. */
const ALL: TripShows = { stays: true, flight: true, documents: true, shopping: true }
const TripShowsContext = createContext<TripShows>(ALL)

/**
 * What this trip shows the caller. Drives the difference between "nothing
 * saved here yet" and "the travellers keep this private" — the two look
 * identical in the payload, because a withheld category simply isn't in it.
 */
export const useTripShows = () => useContext(TripShowsContext)
export { TripShowsContext }

/**
 * True when this caller may change the trip in front of them.
 *
 * Outside a trip — the trips list — there is no per-trip role to consult and
 * nothing to protect: any account may create a trip of its own.
 */
export const useCanEdit = () => {
  const tripRole = useTripRole()
  return tripRole === null || tripRole === 'owner' || tripRole === 'partner'
}

/** True only for a trip's owner: managing who else is on it. */
export const useIsTripOwner = () => useTripRole() === 'owner'

/**
 * Keeps the bearer token api/client.ts sends in step with supabase-js.
 *
 * A Supabase access token lives about an hour and the library rotates it in
 * the background; without this, a tab left open overnight starts sending a
 * stale one and gets bounced to the gate mid-tap.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const supabase = getSupabaseClient()
    if (!supabase) return

    let cancelled = false
    const identifySessionUser = (session: Session) => {
      const personProperties: Record<string, string> = {}
      if (session.user.email) personProperties.email = session.user.email
      const fullName = session.user.user_metadata.full_name
      if (typeof fullName === 'string' && fullName) personProperties.name = fullName
      identify(session.user.id, personProperties)
    }

    // A refresh can begin with an already-authenticated Supabase session. The
    // persisted PostHog identity may be absent (a new browser) so establish it
    // from Supabase's immutable user id before protected screens report data.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled && session) identifySessionUser(session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // A session can end somewhere other than the sign-out button — another
      // tab, an expired refresh token, a revoked account. Without this the
      // bearer token in api/client outlives the session that justified it, and
      // the app keeps rendering as if signed in until a request happens to 401.
      if (event === 'SIGNED_OUT') {
        clearAccessCode()
        return
      }
      if (session) {
        setAccessCode(session.access_token)
        // 'SIGNED_IN' is the one event that means *this* sign-in just happened:
        // a restored session arrives as 'INITIAL_SESSION' and a rotated token as
        // 'TOKEN_REFRESHED'. That distinction is why the sign-in event belongs
        // here and not on the gate — Google and the magic link both leave the
        // page and come back, so the gate's own submit handler never sees them,
        // and the effect that finishes those redirects cannot tell a fresh
        // sign-in from someone merely re-opening the app with a live session.
        if (event === 'SIGNED_IN') {
          identifySessionUser(session)
          // 'google' | 'email' — Supabase records which credential was used.
          capture('user_signed_in', { method: session.user.app_metadata.provider ?? 'unknown' })
        }
      }
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return <>{children}</>
}
