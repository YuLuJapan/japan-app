// The trip a request is operating on, resolved once by one middleware.
//
// This is the choke point the feature is built around. Every content route is
// mounted under /api/trips/:tripId behind `requireTripAccess`, so a route added
// there is access-checked by construction rather than by remembering to. It is
// the same property CLAUDE.md already credits for writes ("guest-proof
// automatically by virtue of its HTTP method"), extended to reads.
//
// What it does NOT yet do: prove that a resource named later in the path
// actually belongs to this trip. `/trips/A/places/<place-in-B>` still resolves,
// because zones are not trip-scoped in the schema until phase 3b. The sweep in
// server/tests/tenancy.test.ts carries those cases as `it.todo`, and 3b is the
// commit that turns them on.
import type { NextFunction, Request, Response } from 'express'
import { assertTripAccess, roleForTrip } from './access.js'
import { accessOf, isGuest } from './auth.js'
import { getDataStore, type Trip } from './datastore.js'
import { forbidden, notFound } from './errors.js'
import { canWrite, type TripRole } from './permissions.js'
import { FULL_VIEW, GUEST_VIEW, tripView, type TripView } from './trip-view.js'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * The one write a viewer may make: walking away from a trip they were invited
 * to. `req.path` is relative to the /api/trips/:tripId mount, so this matches
 * DELETE /members/:userId — services/members.ts then decides whether it is a
 * leave (anyone) or a removal (owners only).
 */
const MEMBER_PATH = /^\/members\/[^/]+$/
const isLeavingTrip = (req: Request) => req.method === 'DELETE' && MEMBER_PATH.test(req.path)

export interface TripContext {
  trip: Trip
  /** What this caller may do here. */
  role: TripRole
  /** What this caller may see here. */
  view: TripView
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requireTripAccess on every route under /api/trips/:tripId. */
    tripContext?: TripContext
  }
}

/**
 * Resolves :tripId into a TripContext, or refuses.
 *
 * A trip that isn't yours answers 404, never 403 — a 403 would confirm it
 * exists to someone with no business knowing that. A member who merely lacks
 * the verb gets a 403 from the service, because they already know it exists.
 */
export async function requireTripAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    const tripId = req.params.tripId
    const access = accessOf(req)
    assertTripAccess(access, tripId)

    const store = await getDataStore()
    const trip = await store.getTrip(tripId)
    if (!trip) throw notFound('Trip')

    const role = roleForTrip(access, tripId)
    if (!role) throw notFound('Trip')

    // The member row decides what this caller is shown. The deprecated guest
    // code has no membership to read, so it keeps its own fixed narrow view.
    const member = access.userId ? await store.getTripMember(tripId, access.userId) : null
    const view = isGuest(req) ? GUEST_VIEW : member ? tripView(member) : FULL_VIEW

    req.tripContext = { trip, role, view }

    // Read-only is a per-trip fact now, so it cannot be enforced where the old
    // guest check was. `authMiddleware` blocks writes for the deprecated guest
    // *code*; a viewer is an ordinary signed-in account and sails straight
    // through it. One check here covers every nested route, including any
    // added later.
    if (!READ_METHODS.has(req.method) && !canWrite(role) && !isLeavingTrip(req)) {
      throw forbidden('You have read-only access to this trip')
    }
    next()
  } catch (err) {
    next(err)
  }
}

/** The resolved trip context. Throws if a route using it was mounted outside the guard. */
export function tripContextOf(req: Request): TripContext {
  if (!req.tripContext) throw notFound('Trip')
  return req.tripContext
}
