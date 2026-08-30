import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { aiConfigured } from '../lib/ai/runtime.js'
import { getDataStore } from '../lib/datastore.js'
import { asyncHandler, forbidden, notFound } from '../lib/errors.js'
import { canWrite } from '../lib/permissions.js'
import { tripContextOf } from '../lib/trip-context.js'
import { getChat } from '../services/chat.js'

/**
 * Two refusals, before any handler, mounted on the path rather than repeated per
 * handler — the `routes/shopping.ts` idiom, so a route added below inherits them
 * the way this whole router inherits `requireTripAccess` one level up.
 *
 * **No key means 404, not 500.** With nothing configured the feature is
 * *absent*, exactly as push is with no VAPID keys and analytics with no PostHog
 * token — a deployment that never set a key has not failed at anything. This is
 * also the real rollout switch: the `chat-bot` client flag hides a button and
 * controls no spend (FR-007, FR-008).
 *
 * **A viewer gets 403, not 404**, because they already know the trip exists —
 * `requireTripAccess` answered 404 for anyone who does not. Chat is writers-only
 * in whole rather than just in its writes, and that is what lets one shared
 * thread exist at all: writers always get the full view, so a transcript they
 * share can reveal nothing either of them was being kept from.
 */
function requireChat(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!aiConfigured()) throw notFound('Chat')
    if (!canWrite(tripContextOf(req).role)) {
      throw forbidden('Chat is available to the trip’s owners and partners')
    }
    next()
  } catch (err) {
    next(err)
  }
}

const read = asyncHandler(async (req, res) => {
  const context = tripContextOf(req)
  res.json(await getChat(await getDataStore(), context.trip.id, req.user!.id))
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const chatTripRouter = Router({ mergeParams: true })
chatTripRouter.use('/chat', requireChat)
chatTripRouter.get('/chat', read)
