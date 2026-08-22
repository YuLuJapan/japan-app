// What this caller can reach, resolved once per request.
//
// Until phase 3a nests every content route under /api/trips/:tripId, most
// routes are addressed by a bare resource id and have no trip in the path.
// This is what stands in for that: the middleware resolves the caller's
// memberships once, and services ask it rather than re-querying.
//
// The deprecated static access codes resolve to `'all'`, which is not
// laziness — it is what keeps this change invisible to the existing
// deployment. The travellers' code behaves exactly as it did before
// membership existed, while accounts get the scoped view.
import type { DataStore, Trip, TripMember } from './datastore.js'
import { notFound } from './errors.js'
import type { TripRole } from './permissions.js'

export interface AccessContext {
  /** null for the static access codes — they prove a right, not an identity. */
  userId: string | null
  /** Trip ids this caller may touch, or 'all' for the legacy codes. */
  tripIds: readonly string[] | 'all'
  /** Per-trip role for a signed-in account. Empty for the legacy codes. */
  roles: ReadonlyMap<string, TripRole>
}

/** The legacy owner code: every trip, as before membership existed. */
export const LEGACY_ACCESS: AccessContext = {
  userId: null,
  tripIds: 'all',
  roles: new Map(),
}

export async function accessForUser(store: DataStore, userId: string): Promise<AccessContext> {
  const memberships = await store.listMembershipsForUser(userId)
  return {
    userId,
    tripIds: memberships.map((m) => m.trip_id),
    roles: new Map(memberships.map((m) => [m.trip_id, m.role])),
  }
}

export const canReachTrip = (access: AccessContext, tripId: string): boolean =>
  access.tripIds === 'all' || access.tripIds.includes(tripId)

/**
 * The caller's role on a trip, or null when it isn't theirs. The legacy owner
 * code reads as 'owner' everywhere; the guest code's narrower view is still
 * driven by `req.role` until phase 4 replaces it with per-member visibility.
 */
export function roleForTrip(access: AccessContext, tripId: string): TripRole | null {
  if (access.tripIds === 'all') return 'owner'
  return access.roles.get(tripId) ?? null
}

/**
 * 404, never 403, for a trip that isn't yours — a 403 would confirm the trip
 * exists to someone with no business knowing that. A member who merely lacks
 * the verb does get a 403: they already know it exists.
 */
export function assertTripAccess(access: AccessContext, tripId: string): void {
  if (!canReachTrip(access, tripId)) throw notFound('Trip')
}

/**
 * The trip row, for a caller whose access has already been established.
 *
 * Every content route runs behind `requireTripAccess`, which checks membership
 * before the handler is entered — so services below it need the trip, not the
 * access context. Loading it again is one indexed lookup and keeps them free of
 * Express.
 */
export async function requireTrip(store: DataStore, tripId: string): Promise<Trip> {
  const trip = await store.getTrip(tripId)
  if (!trip) throw notFound('Trip')
  return trip
}

export type { TripMember }
