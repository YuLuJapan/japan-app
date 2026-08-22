// Who is on a trip, and what they may do there.
//
// The rules themselves live in lib/permissions.ts as pure functions; this is
// the layer that applies them and holds the one invariant Postgres cannot
// express without a deferred constraint trigger: **every trip keeps at least
// one owner**. A trip with no owner is not merely awkward — it is unreachable
// by anyone, forever, since membership is the only way in.
import type { DataStore, TripMember } from '../lib/datastore.js'
import { forbidden, notFound, validation } from '../lib/errors.js'
import { canManageMembers, isTripRole, type TripRole } from '../lib/permissions.js'

export interface MemberView {
  user_id: string
  role: TripRole
  email: string
  display_name: string | null
  avatar_url: string | null
  can_see_stays: boolean
  can_see_flight: boolean
  can_see_documents: boolean
  can_see_shopping: boolean
}

/** Members with their profiles attached, owners first, then by name. */
export async function listMembers(store: DataStore, tripId: string) {
  const members = await store.listTripMembers(tripId)
  const rows = await Promise.all(
    members.map(async (m) => {
      const profile = await store.getProfile(m.user_id)
      return {
        user_id: m.user_id,
        role: m.role,
        email: profile?.email ?? '',
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
        can_see_stays: m.can_see_stays,
        can_see_flight: m.can_see_flight,
        can_see_documents: m.can_see_documents,
        can_see_shopping: m.can_see_shopping,
      }
    })
  )
  const rank: Record<TripRole, number> = { owner: 0, partner: 1, viewer: 2 }
  rows.sort(
    (a, b) =>
      rank[a.role] - rank[b.role] ||
      (a.display_name ?? a.email).localeCompare(b.display_name ?? b.email)
  )
  return { members: rows }
}

const ownersOf = (members: TripMember[]) => members.filter((m) => m.role === 'owner')

/**
 * The last owner cannot be demoted or removed, and cannot leave.
 *
 * Checked against the stored rows rather than the caller's own belief about
 * them, so two owners demoting each other in parallel cannot both succeed.
 */
async function assertNotLastOwner(store: DataStore, tripId: string, userId: string) {
  const owners = ownersOf(await store.listTripMembers(tripId))
  if (owners.length === 1 && owners[0].user_id === userId) {
    throw validation(['This trip would be left with no owner. Make someone else an owner first.'])
  }
}

export interface MemberPatch {
  role?: unknown
  can_see_stays?: unknown
  can_see_flight?: unknown
  can_see_documents?: unknown
  can_see_shopping?: unknown
}

export async function updateMember(
  store: DataStore,
  tripId: string,
  actorRole: TripRole,
  userId: string,
  patch: MemberPatch
) {
  if (!canManageMembers(actorRole)) throw forbidden('Only an owner can change who is on this trip')

  const existing = await store.getTripMember(tripId, userId)
  if (!existing) throw notFound('Member')

  const errors: string[] = []
  if (patch.role !== undefined && !isTripRole(patch.role)) {
    errors.push('role must be one of: owner, partner, viewer')
  }
  for (const key of [
    'can_see_stays',
    'can_see_flight',
    'can_see_documents',
    'can_see_shopping',
  ] as const) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') {
      errors.push(`${key} must be true or false`)
    }
  }
  if (errors.length) throw validation(errors)

  const nextRole = (patch.role as TripRole | undefined) ?? existing.role
  if (existing.role === 'owner' && nextRole !== 'owner') {
    await assertNotLastOwner(store, tripId, userId)
  }

  const member = await store.upsertTripMember({
    trip_id: tripId,
    user_id: userId,
    role: nextRole,
    can_see_stays: (patch.can_see_stays as boolean | undefined) ?? existing.can_see_stays,
    can_see_flight: (patch.can_see_flight as boolean | undefined) ?? existing.can_see_flight,
    can_see_documents:
      (patch.can_see_documents as boolean | undefined) ?? existing.can_see_documents,
    can_see_shopping: (patch.can_see_shopping as boolean | undefined) ?? existing.can_see_shopping,
  })
  return { member }
}

/**
 * Removing someone else needs owner rights; removing yourself is "leave" and
 * needs none — anyone may walk away from a trip they were invited to.
 */
export async function removeMember(
  store: DataStore,
  tripId: string,
  actor: { role: TripRole; userId: string | null },
  userId: string
) {
  const leaving = actor.userId === userId
  if (!leaving && !canManageMembers(actor.role)) {
    throw forbidden('Only an owner can remove someone from this trip')
  }
  if (!(await store.getTripMember(tripId, userId))) throw notFound('Member')
  await assertNotLastOwner(store, tripId, userId)
  await store.removeTripMember(tripId, userId)
}
