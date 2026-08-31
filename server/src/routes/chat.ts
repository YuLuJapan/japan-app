import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { aiConfigured } from '../lib/ai/runtime.js'
import { getDataStore, type DataStore } from '../lib/datastore.js'
import { ApiError, asyncHandler, forbidden, notFound } from '../lib/errors.js'
import { canWrite } from '../lib/permissions.js'
import { tripContextOf } from '../lib/trip-context.js'
import { eventStream } from '../lib/sse.js'
import { getChat, runChatTurn, type TurnContext } from '../services/chat.js'

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

/**
 * One turn, streamed.
 *
 * The refusals — a bad question, the cap, a turn already running — all happen
 * inside `runChatTurn` **before it yields anything**, which is what lets them
 * arrive as ordinary error envelopes with a real status. Once one event has been
 * sent the status is spent, and a failure has to travel as an `error` event so
 * the client keeps the partial text it has been reading.
 */
const turn = asyncHandler(async (req, res) => {
  const store = await getDataStore()
  const stream = eventStream(res)

  try {
    for await (const event of runChatTurn(store, await turnContext(req, store), bodyContent(req))) {
      stream.send(event)
    }
  } catch (err) {
    // Nothing sent yet, so the status is still unspent: let the error middleware
    // answer properly.
    if (!stream.opened) throw err
    stream.send(streamError(err))
  }

  // A turn that yielded nothing at all still has to answer something.
  if (!stream.opened) stream.send({ type: 'done', complete: false })
  stream.end()
})

/** Who is asking, and about which trip. */
async function turnContext(req: Request, store: DataStore): Promise<TurnContext> {
  const profile = await store.getProfile(req.user!.id)
  return {
    trip: tripContextOf(req).trip,
    userId: req.user!.id,
    author: profile?.display_name || profile?.email || null,
  }
}

const bodyContent = (req: Request): unknown => (req.body ?? {}).content

/**
 * A failure that arrived too late for a status code.
 *
 * A validation message is safe to show; a 500 can carry anything, and telling
 * them apart at this point is guesswork — the same reasoning the client's error
 * reporting uses (src/api/queryClient.ts).
 */
function streamError(err: unknown) {
  if (err instanceof ApiError) return { type: 'error', code: err.code, message: err.message }
  console.error(err)
  return { type: 'error', code: 'INTERNAL', message: 'Something went wrong' }
}

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const chatTripRouter = Router({ mergeParams: true })
chatTripRouter.use('/chat', requireChat)
chatTripRouter.get('/chat', read)
chatTripRouter.post('/chat/messages', turn)
