// Who may do what on a trip. Pure functions over a role — no I/O, no Express,
// no datastore — so the rules are readable in one screen and exhaustively
// testable without a server.
//
// The point of centralising these is that no route ever writes `role ===
// 'owner'` inline. A capability that lives in one function can be audited;
// one spelled out at eleven call sites cannot.
//
// Two independent axes, deliberately not collapsed:
//   this file   — which *verbs* a role may use
//   trip-view   — which *content* a viewer is shown (phase 4)

export const TRIP_ROLES = ['owner', 'partner', 'viewer'] as const
export type TripRole = (typeof TRIP_ROLES)[number]

/** `owner` is deliberately ungrantable by invite — see the trip_invites check constraint. */
export type InviteRole = Exclude<TripRole, 'owner'>

/** Adding, editing and deleting the trip's content. */
export const canWrite = (role: TripRole) => role === 'owner' || role === 'partner'

/** Changing the trip's own dates, title and country. */
export const canEditTrip = (role: TripRole) => canWrite(role)

export const canDeleteTrip = (role: TripRole) => role === 'owner'

/** Editing the member list itself — role changes, visibility changes, removal. */
export const canManageMembers = (role: TripRole) => role === 'owner'

/**
 * Issuing an invite. A partner may bring in viewers, never another writer:
 * without the target check a partner could invite another partner, who invites
 * another, spreading write access laterally with no owner ever in the loop.
 */
export const canInvite = (role: TripRole, target: InviteRole) =>
  role === 'owner' || (role === 'partner' && target === 'viewer')

export const isTripRole = (value: unknown): value is TripRole =>
  typeof value === 'string' && (TRIP_ROLES as readonly string[]).includes(value)
