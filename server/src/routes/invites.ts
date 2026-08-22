// The invite link itself: /api/invites/:token
//
// Not trip-scoped, and it cannot be — the whole point is that the caller is not
// yet a member. The token *is* the authorization: whoever holds it may see the
// preview and, once signed in, accept it.
//
// It is still behind authMiddleware, so a signed-out browser gets a 401 and the
// accept screen sends them to sign in first. Preview is deliberately thin: an
// unaccepted invitation is not access, so it carries no trip content.
import { Router } from 'express'
import { currentUser } from '../lib/auth.js'
import { getDataStore } from '../lib/datastore.js'
import { ApiError, asyncHandler } from '../lib/errors.js'
import { acceptInvite, previewInvite } from '../services/invites.js'

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
    const user = currentUser(req)
    if (!user) {
      // A shared access code proves a right, not an identity — there is nobody
      // to make a member of the trip.
      throw new ApiError(403, 'FORBIDDEN', 'Sign in with an account to accept an invitation')
    }
    res.json(await acceptInvite(await getDataStore(), user, req.params.token))
  })
)
