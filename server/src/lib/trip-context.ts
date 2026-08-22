// The trip a request is operating on, resolved once by one middleware.
//
// This is the choke point the feature is built around. Every content route is
// mounted under /api/trips/:tripId behind `requireTripAccess`, so a route added
// there is access-checked by construction rather than by remembering to. It is
// the same property CLAUDE.md already credits for writes ("guest-proof
// automatically by virtue of its HTTP method"), extended to reads.
//
import type { NextFunction, Request, Response } from 'express'
import { assertTripAccess } from './access.js'
import { accessOf } from './auth.js'
import { getDataStore, type Trip } from './datastore.js'
import { forbidden, notFound } from './errors.js'
import { canWrite, type TripRole } from './permissions.js'
import { tripView, type TripView } from './trip-view.js'

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

    // One row answers both questions: which verbs (role) and which content
    // (the three can_see_* flags). `assertTripAccess` has already established
    // that it exists; re-reading it here rather than trusting the cached role
    // keeps the flags and the role from ever disagreeing.
    const member = await store.getTripMember(tripId, access.userId)
    if (!member) throw notFound('Trip')
    const role = member.role

    req.tripContext = { trip, role, view: tripView(member) }

    // Read-only is a per-trip fact: a viewer is an ordinary signed-in account,
    // indistinguishable at the door from an owner. This one check covers every
    // nested route, including any added later — the property that used to come
    // free from the guest code's blanket method check, restored where it can
    // actually see whose trip this is.
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
