// Who is on a trip, and the invitations out to more people.
//
// Mounted under /api/trips/:tripId, so membership is already established by
// requireTripAccess — what these routes decide is the *verb*, via the pure
// rules in lib/permissions.ts.
import { Router } from 'express'
import { currentUser } from '../lib/auth.js'
import { getDataStore } from '../lib/datastore.js'
import { asyncHandler } from '../lib/errors.js'
import { tripContextOf } from '../lib/trip-context.js'
import { createInvite, listInvites, revokeInvite } from '../services/invites.js'
import { listMembers, removeMember, updateMember } from '../services/members.js'

export const membersTripRouter = Router({ mergeParams: true })

membersTripRouter.get(
  '/members',
  asyncHandler(async (req, res) => {
    res.json(await listMembers(await getDataStore(), req.params.tripId))
  })
)

membersTripRouter.patch(
  '/members/:userId',
  asyncHandler(async (req, res) => {
    res.json(
      await updateMember(
        await getDataStore(),
        req.params.tripId,
        tripContextOf(req).role,
        req.params.userId,
        req.body ?? {}
      )
    )
  })
)

membersTripRouter.delete(
  '/members/:userId',
  asyncHandler(async (req, res) => {
    await removeMember(
      await getDataStore(),
      req.params.tripId,
      { role: tripContextOf(req).role, userId: currentUser(req)?.id ?? null },
      req.params.userId
    )
    res.status(204).end()
  })
)

membersTripRouter.get(
  '/invites',
  asyncHandler(async (req, res) => {
    res.json(await listInvites(await getDataStore(), req.params.tripId, tripContextOf(req).role))
  })
)

membersTripRouter.post(
  '/invites',
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await createInvite(
          await getDataStore(),
          req.params.tripId,
          { role: tripContextOf(req).role, userId: currentUser(req)?.id ?? null },
          req.body ?? {}
        )
      )
  })
)

membersTripRouter.delete(
  '/invites/:inviteId',
  asyncHandler(async (req, res) => {
    await revokeInvite(
      await getDataStore(),
      req.params.tripId,
      { role: tripContextOf(req).role, userId: currentUser(req)?.id ?? null },
      req.params.inviteId
    )
    res.status(204).end()
  })
)
