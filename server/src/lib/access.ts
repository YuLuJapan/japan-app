// What this caller can reach, resolved once per request.
//
// The middleware resolves the signed-in account's memberships once, and
// services ask this rather than re-querying. There is no "sees everything"
// context any more — every caller is a person, and a person reaches exactly
// the trips they are a member of. That was the last thing standing between
// this app and a shared credential that opened the whole database.
import type { DataStore, Trip, TripMember } from './datastore.js'
import { notFound } from './errors.js'
import type { TripRole } from './permissions.js'

export interface AccessContext {
  /** The signed-in account. Always present: there is no other kind of caller. */
  userId: string
  /** Exactly the trips this caller is a member of. */
  tripIds: readonly string[]
  /** This caller's role on each of them. */
  roles: ReadonlyMap<string, TripRole>
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
  access.tripIds.includes(tripId)

/** The caller's role on a trip, or null when it isn't theirs. */
export const roleForTrip = (access: AccessContext, tripId: string): TripRole | null =>
  access.roles.get(tripId) ?? null

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
