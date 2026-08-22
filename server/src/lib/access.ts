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
import { getDefaultTrip } from './datastore.js'
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
 * Every zone reachable from the caller's trips, via their journey steps.
 *
 * Zones are not trip-scoped in the schema yet — that is phase 3b, and it needs
 * a migration that duplicates zones shared by two trips. Until then this closes
 * the hole that scoping would close structurally: zone ids are human-readable
 * seed values like `zone-tokyo`, so without it any signed-up stranger could
 * guess one and read a city's places — stays included, and a stay's description
 * *is* the accommodation booking.
 *
 * Returns 'all' for the legacy codes, unchanged from today.
 */
export async function reachableZoneIds(
  store: DataStore,
  access: AccessContext
): Promise<ReadonlySet<string> | 'all'> {
  if (access.tripIds === 'all') return 'all'
  const stepLists = await Promise.all(access.tripIds.map((id) => store.listSteps(id)))
  return new Set(stepLists.flat().map((s) => s.zone_id))
}

export const canReachZone = (zones: ReadonlySet<string> | 'all', zoneId: string): boolean =>
  zones === 'all' || zones.has(zoneId)

/** 404 for a zone outside the caller's trips, for the same reason as trips. */
export function assertZoneAccess(zones: ReadonlySet<string> | 'all', zoneId: string): void {
  if (!canReachZone(zones, zoneId)) throw notFound('Zone')
}

/**
 * The trip a request operates on: the one named in the path, or — for the
 * single-trip-era routes that carry no trip id — the caller's oldest.
 *
 * Nine services repeated `tripId ? getTrip(tripId) : getDefaultTrip(store)`,
 * which had no notion of who was asking. Folding them into one helper is what
 * adds the membership check everywhere at once, rather than nine chances to
 * forget it. Phase 3a deletes the second half of this when every route carries
 * an explicit /api/trips/:tripId.
 */
export async function resolveTrip(
  store: DataStore,
  access: AccessContext,
  tripId?: string
): Promise<Trip> {
  if (tripId) {
    assertTripAccess(access, tripId)
    const trip = await store.getTrip(tripId)
    if (!trip) throw notFound('Trip')
    return trip
  }
  const trip = await getDefaultTrip(store, access.userId)
  // A brand-new account with no trips yet lands here, and so does anyone
  // poking at a legacy route for a trip that is not theirs. Both get the same
  // answer, which is the point.
  if (!trip) throw notFound('Trip')
  return trip
}

export type { TripMember }
