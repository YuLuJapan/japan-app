// Sharing a trip.
//
// An invite is a link, not an email: the server mints a token, returns the
// plaintext exactly once, and stores only its SHA-256. Whoever opens the link
// and signs in becomes a member with the role and visibility the invite
// promised. No mail infrastructure, which keeps this inside the free tier and
// matches how `trips.people` already offers a mailto: invite.
//
// The plaintext is unrecoverable afterwards — the same discipline as a
// password reset token, and the reason a leaked backup hands out no working
// invites.
import { createHash, randomBytes } from 'node:crypto'
import type { DataStore, TripInvite } from '../lib/datastore.js'
import { forbidden, notFound, validation } from '../lib/errors.js'
import { canInvite, type InviteRole, type TripRole } from '../lib/permissions.js'

const INVITE_TTL_DAYS = 14
const INVITE_ROLES: InviteRole[] = ['partner', 'viewer']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 256 bits: brute-forcing this is not a threat model worth rate-limiting for. */
const mintToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const isOpen = (invite: TripInvite, now: Date) =>
  !invite.accepted_at && !invite.revoked_at && new Date(invite.expires_at) > now

export interface InviteInput {
  role?: unknown
  email?: unknown
  can_see_stays?: unknown
  can_see_flight?: unknown
  can_see_documents?: unknown
}

export async function listInvites(store: DataStore, tripId: string, actorRole: TripRole) {
  if (!canInvite(actorRole, 'viewer')) {
    throw forbidden('Only the travellers on this trip can see its invitations')
  }
  const invites = await store.listTripInvites(tripId)
  const now = new Date()
  return { invites: invites.filter((i) => isOpen(i, now)) }
}

export async function createInvite(
  store: DataStore,
  tripId: string,
  actor: { role: TripRole; userId: string | null },
  body: InviteInput,
  now: Date = new Date()
) {
  const role = body.role
  if (!INVITE_ROLES.includes(role as InviteRole)) {
    throw validation([`role must be one of: ${INVITE_ROLES.join(', ')}`])
  }
  // The target role is what stops a partner inviting another partner and
  // spreading write access sideways with no owner in the loop.
  if (!canInvite(actor.role, role as InviteRole)) {
    throw forbidden(
      actor.role === 'partner'
        ? 'Partners can invite viewers only — ask an owner to add another partner'
        : 'Only the travellers on this trip can invite people'
    )
  }

  const errors: string[] = []
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (email && !EMAIL_RE.test(email)) errors.push('email must be a valid email address')
  for (const key of ['can_see_stays', 'can_see_flight', 'can_see_documents'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      errors.push(`${key} must be true or false`)
    }
  }
  if (errors.length) throw validation(errors)

  const token = mintToken()
  const expires = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
  const invite = await store.createTripInvite({
    trip_id: tripId,
    email: email || null,
    role: role as InviteRole,
    can_see_stays: (body.can_see_stays as boolean | undefined) ?? true,
    can_see_flight: (body.can_see_flight as boolean | undefined) ?? true,
    // A document is a raw file whose contents the owner cannot audit at a
    // glance, so it is the one thing off by default.
    can_see_documents: (body.can_see_documents as boolean | undefined) ?? false,
    token_hash: hashToken(token),
    invited_by: actor.userId,
    expires_at: expires.toISOString(),
  })

  // The only time the plaintext exists outside the caller's clipboard.
  return { invite, token }
}

export async function revokeInvite(
  store: DataStore,
  tripId: string,
  actor: { role: TripRole; userId: string | null },
  inviteId: string
) {
  const invite = await store.getTripInvite(tripId, inviteId)
  if (!invite) throw notFound('Invitation')
  // Owners revoke anything; a partner revokes only what they issued.
  const mine = invite.invited_by !== null && invite.invited_by === actor.userId
  if (actor.role !== 'owner' && !(actor.role === 'partner' && mine)) {
    throw forbidden('You can only revoke invitations you sent')
  }
  await store.updateTripInvite(inviteId, { revoked_at: new Date().toISOString() })
}

/**
 * What the person holding the link is told before they sign in.
 *
 * Deliberately minimal — the trip's name, who asked them, what they would get.
 * An unaccepted invite is not access, so it carries no trip content.
 */
export async function previewInvite(store: DataStore, token: string, now: Date = new Date()) {
  const invite = await store.getInviteByTokenHash(hashToken(String(token ?? '')))
  if (!invite || !isOpen(invite, now)) throw notFound('Invitation')
  const [trip, inviter] = await Promise.all([
    store.getTrip(invite.trip_id),
    invite.invited_by ? store.getProfile(invite.invited_by) : Promise.resolve(null),
  ])
  if (!trip) throw notFound('Invitation')
  return {
    invite: {
      trip_name: trip.name,
      role: invite.role,
      invited_by: inviter?.display_name ?? inviter?.email ?? null,
      email: invite.email,
      expires_at: invite.expires_at,
      shows: {
        stays: invite.role === 'viewer' ? invite.can_see_stays : true,
        flight: invite.role === 'viewer' ? invite.can_see_flight : true,
        documents: invite.role === 'viewer' ? invite.can_see_documents : true,
      },
    },
  }
}

export async function acceptInvite(
  store: DataStore,
  user: { id: string; email: string },
  token: string,
  now: Date = new Date()
) {
  const invite = await store.getInviteByTokenHash(hashToken(String(token ?? '')))
  if (!invite || !isOpen(invite, now)) throw notFound('Invitation')

  if (invite.email && invite.email.toLowerCase() !== user.email.trim().toLowerCase()) {
    throw forbidden('This invitation was sent to a different email address')
  }

  const existing = await store.getTripMember(invite.trip_id, user.id)
  if (existing) {
    // Idempotent, and never a downgrade: re-opening the link with a higher
    // role already in hand must not demote you.
    await store.updateTripInvite(invite.id, {
      accepted_at: now.toISOString(),
      accepted_by: user.id,
    })
    return { trip_id: invite.trip_id, role: existing.role, already_member: true }
  }

  // Claim the invite first: `updateTripInvite` only stamps a still-open row, so
  // two racing accepts cannot both get through.
  const claimed = await store.updateTripInvite(invite.id, {
    accepted_at: now.toISOString(),
    accepted_by: user.id,
  })
  if (!claimed) throw notFound('Invitation')

  await store.upsertTripMember({
    trip_id: invite.trip_id,
    user_id: user.id,
    role: invite.role,
    can_see_stays: invite.can_see_stays,
    can_see_flight: invite.can_see_flight,
    can_see_documents: invite.can_see_documents,
  })
  return { trip_id: invite.trip_id, role: invite.role, already_member: false }
}
