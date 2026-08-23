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
import { setAccessCode } from '../api/client'
import type { TripRole, TripShows } from '../api/types'
import posthog from './posthog'
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
      posthog.identify(session.user.id, personProperties)
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
      if (session) {
        setAccessCode(session.access_token)
        if (event === 'SIGNED_IN') identifySessionUser(session)
      }
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return <>{children}</>
}
