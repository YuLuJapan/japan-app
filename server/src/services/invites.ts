// Sharing a trip. Two ways in, and they authorize differently.
//
// **The link.** The server mints a token, returns the plaintext exactly once,
// and stores only its SHA-256. Whoever opens the link and signs in becomes a
// member with the role and visibility the invite promised. The plaintext is
// unrecoverable afterwards — the same discipline as a password reset token,
// and the reason a leaked backup hands out no working invites.
//
// **The inbox.** An invitation addressed to an email address is also claimable
// by the account that owns that address, with no link at all: it simply
// appears when they next sign in. This is what makes the email optional rather
// than load-bearing — the link can be shared over WhatsApp, or not shared at
// all, and the invitation still arrives.
//
// The authorization there is "your *confirmed* sign-in email matches the
// invitation". Confirmed is the whole of it: anyone can type someone else's
// address at sign-up, so an unconfirmed one proves nothing about who holds it.
import { createHash, randomBytes } from 'node:crypto'
import type { DataStore, TripInvite } from '../lib/datastore.js'
import { forbidden, notFound, validation } from '../lib/errors.js'
import { canInvite, type InviteRole, type TripRole } from '../lib/permissions.js'
import { tripTitle } from './trips.js'

const INVITE_TTL_DAYS = 14
const INVITE_ROLES: InviteRole[] = ['partner', 'viewer']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 256 bits: brute-forcing this is not a threat model worth rate-limiting for. */
const mintToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const isOpen = (invite: TripInvite, now: Date) =>
  !invite.accepted_at &&
  !invite.revoked_at &&
  !invite.declined_at &&
  new Date(invite.expires_at) > now

/** Case-insensitive, trimmed: email addresses are, and people paste them. */
const sameAddress = (a: string | null, b: string) =>
  !!a && a.trim().toLowerCase() === b.trim().toLowerCase()

export interface InviteInput {
  role?: unknown
  email?: unknown
  can_see_stays?: unknown
  can_see_flight?: unknown
  can_see_documents?: unknown
  can_see_shopping?: unknown
}

export async function listInvites(store: DataStore, tripId: string, actorRole: TripRole) {
  if (!canInvite(actorRole, 'viewer')) {
    throw forbidden('Only the travellers on this trip can see its invitations')
  }
  const invites = await store.listTripInvites(tripId)
  const now = new Date()
  // Declined ones are kept, and say so. An invitation that quietly disappears
  // leaves the inviter wondering whether they sent it at all.
  return { invites: invites.filter((i) => isOpen(i, now) || i.declined_at) }
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
  for (const key of [
    'can_see_stays',
    'can_see_flight',
    'can_see_documents',
    'can_see_shopping',
  ] as const) {
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
    can_see_shopping: (body.can_see_shopping as boolean | undefined) ?? true,
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
  return { invite: await summarize(store, invite) }
}

/**
 * What someone is told about an invitation *before* they hold it: the trip's
 * title, who asked them, and what they would be shown. Never any trip content
 * — an unaccepted invitation is not access.
 *
 * The title is the computed one, not the raw `name`: a trip that goes by
 * "Yuval and Luciana in Japan" has no `name` at all (feature 002 phase 5), and
 * an invitation to a blank was the shape of the bug this avoids.
 */
async function summarize(store: DataStore, invite: TripInvite) {
  const [trip, inviter] = await Promise.all([
    store.getTrip(invite.trip_id),
    invite.invited_by ? store.getProfile(invite.invited_by) : Promise.resolve(null),
  ])
  if (!trip) throw notFound('Invitation')
  const writer = invite.role !== 'viewer'
  return {
    id: invite.id,
    trip_name: await tripTitle(store, trip),
    role: invite.role,
    invited_by: inviter?.display_name ?? inviter?.email ?? null,
    email: invite.email,
    expires_at: invite.expires_at,
    // Writers see everything regardless of the flags — same rule tripView
    // applies, stated here so the promise matches what accepting delivers.
    shows: {
      stays: writer || invite.can_see_stays,
      flight: writer || invite.can_see_flight,
      documents: writer || invite.can_see_documents,
      shopping: writer || invite.can_see_shopping,
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

  if (invite.email && !sameAddress(invite.email, user.email)) {
    throw forbidden('This invitation was sent to a different email address')
  }

  return claim(store, user, invite, now)
}

/**
 * Stamp the invitation and put the account on the trip. Shared by both routes
 * in: the link (authorized by the token) and the inbox (authorized by the
 * confirmed address). Everything above this line decides *whether*; this
 * decides *what happens*, once.
 */
async function claim(
  store: DataStore,
  user: { id: string; email: string },
  invite: TripInvite,
  now: Date
) {
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
    can_see_shopping: invite.can_see_shopping,
  })
  return { trip_id: invite.trip_id, role: invite.role, already_member: false }
}

// --- the invitee's side ------------------------------------------------------
// Everything above is addressed to a *trip*: its owner mints, lists and revokes.
// What follows is addressed to a *person*, so none of it takes a tripId — the
// invitee does not know the trip yet, which is rather the point.

/** An account whose address Supabase has confirmed, or `null` if it hasn't. */
type Invitee = { id: string; email: string; email_confirmed: boolean }

/**
 * Every open invitation waiting for this account.
 *
 * An unconfirmed address returns nothing and says so, rather than 403-ing: the
 * caller has done nothing wrong, they just haven't proved the address is
 * theirs yet, and the UI can point them at their inbox. Nothing leaks either
 * way — they already know their own email and its confirmation state.
 */
export async function listMyInvitations(store: DataStore, user: Invitee, now: Date = new Date()) {
  if (!user.email_confirmed) return { invitations: [], email_unconfirmed: true as const }
  const invites = await store.listInvitesForEmail(user.email)
  const open = invites.filter((i) => isOpen(i, now))
  // A trip they are already on is not an invitation any more — accepting it
  // would be a no-op, and offering it reads as an error.
  const memberships = new Set((await store.listMembershipsForUser(user.id)).map((m) => m.trip_id))
  const pending = open.filter((i) => !memberships.has(i.trip_id))
  return { invitations: await Promise.all(pending.map((i) => summarize(store, i))) }
}

/**
 * The invitation this account is about to act on, or a refusal.
 *
 * 404 rather than 403 for one addressed to somebody else: an invitation id is
 * not a secret worth confirming to a caller it does not name.
 */
async function requireMine(store: DataStore, user: Invitee, inviteId: string, now: Date) {
  if (!user.email_confirmed) {
    throw forbidden('Confirm your email address first — check your inbox for the link')
  }
  const invite = await store.getInviteById(String(inviteId ?? ''))
  if (!invite || !isOpen(invite, now)) throw notFound('Invitation')
  if (!sameAddress(invite.email, user.email)) throw notFound('Invitation')
  return invite
}

/** Accept without ever having seen the link. */
export async function acceptInvitation(
  store: DataStore,
  user: Invitee,
  inviteId: string,
  now: Date = new Date()
) {
  return claim(store, user, await requireMine(store, user, inviteId, now), now)
}

/**
 * Say no. Stamped as its own state rather than as a revocation, so the
 * inviter's list can say "declined" instead of dropping the row and leaving
 * them to wonder whether they ever sent it.
 */
export async function declineInvitation(
  store: DataStore,
  user: Invitee,
  inviteId: string,
  now: Date = new Date()
) {
  const invite = await requireMine(store, user, inviteId, now)
  const declined = await store.updateTripInvite(invite.id, { declined_at: now.toISOString() })
  // Only a still-open row can be stamped, so a lost race reads as "gone".
  if (!declined) throw notFound('Invitation')
}
