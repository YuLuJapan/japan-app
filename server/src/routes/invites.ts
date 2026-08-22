// Invitations, from both ends.
//
// `/api/invites/:token` — the link. Not trip-scoped, and it cannot be: the
// whole point is that the caller is not yet a member. The token *is* the
// authorization. It is still behind authMiddleware, so a signed-out browser
// gets a 401 and the accept screen sends them to sign in first.
//
// `/api/invitations` — the inbox. Also not trip-scoped, for the same reason,
// but authorized by the caller's confirmed email address rather than by a
// secret they hold. This is what lets an invitation arrive without the link
// ever being sent.
//
// Preview is deliberately thin at both ends: an unaccepted invitation is not
// access, so it carries no trip content.
import { Router } from 'express'
import { currentUser } from '../lib/auth.js'
import { getDataStore } from '../lib/datastore.js'
import { asyncHandler } from '../lib/errors.js'
import {
  acceptInvitation,
  acceptInvite,
  declineInvitation,
  listMyInvitations,
  previewInvite,
} from '../services/invites.js'

export const invitesRouter = Router()

invitesRouter.get(
  '/invites/:token',
  asyncHandler(async (req, res) => {
    res.json(await previewInvite(await getDataStore(), req.params.token))
  })
)

invitesRouter.post(
  '/invites/:token/accept',
  asyncHandler(async (req, res) => {
    res.json(await acceptInvite(await getDataStore(), currentUser(req), req.params.token))
  })
)

// A separate prefix from /invites/:token on purpose: these are addressed by
// invitation id, and an id must never be mistaken for a token.
invitesRouter.get(
  '/invitations',
  asyncHandler(async (req, res) => {
    res.json(await listMyInvitations(await getDataStore(), currentUser(req)))
  })
)

invitesRouter.post(
  '/invitations/:inviteId/accept',
  asyncHandler(async (req, res) => {
    res.json(await acceptInvitation(await getDataStore(), currentUser(req), req.params.inviteId))
  })
)

invitesRouter.post(
  '/invitations/:inviteId/decline',
  asyncHandler(async (req, res) => {
    await declineInvitation(await getDataStore(), currentUser(req), req.params.inviteId)
    res.status(204).end()
  })
)
