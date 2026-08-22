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
import { notFound } from './errors.js'
import type { TripRole } from './permissions.js'
import { FULL_VIEW, GUEST_VIEW, type TripView } from './trip-view.js'

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

    const trip = await (await getDataStore()).getTrip(tripId)
    if (!trip) throw notFound('Trip')

    const role = roleForTrip(access, tripId)
    if (!role) throw notFound('Trip')

    req.tripContext = {
      trip,
      role,
      // Phase 4 reads these three flags off the caller's trip_members row.
      // Until then the deprecated guest code is the only restricted view.
      view: isGuest(req) ? GUEST_VIEW : FULL_VIEW,
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
