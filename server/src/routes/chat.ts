import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { aiConfigured } from '../lib/ai/runtime.js'
import { getDataStore } from '../lib/datastore.js'
import { ApiError, asyncHandler, forbidden, notFound } from '../lib/errors.js'
import { canWrite } from '../lib/permissions.js'
import { tripContextOf } from '../lib/trip-context.js'
import { getChat, runChatTurn } from '../services/chat.js'

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
 * arrive as ordinary error envelopes with a real status. Once a single event has
 * been written the status is already 200 and it is too late: from that point a
 * failure is an `error` *event*, and the client keeps the partial text it has
 * been reading rather than having it replaced by an error page.
 *
 * That is why headers are flushed on the first event rather than up front.
 */
const turn = asyncHandler(async (req, res) => {
  const context = tripContextOf(req)
  const store = await getDataStore()
  const profile = await store.getProfile(req.user!.id)

  const events = runChatTurn(
    store,
    {
      trip: context.trip,
      userId: req.user!.id,
      author: profile?.display_name || profile?.email || null,
    },
    (req.body ?? {}).content
  )

  let opened = false
  try {
    for await (const event of events) {
      if (!opened) {
        opened = true
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        // `no-transform` above and this header together stop a proxy buffering
        // the stream into one response at the end — which would leave the
        // traveller watching a blank screen and then a whole answer, exactly
        // what streaming is here to avoid.
        res.setHeader('X-Accel-Buffering', 'no')
        res.flushHeaders()
      }
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
  } catch (err) {
    // Nothing written yet: let the error middleware answer properly, with a
    // status and the envelope every other route produces.
    if (!opened) throw err

    // Mid-stream. The status is spent, so the failure has to travel as an event.
    const known = err instanceof ApiError
    res.write(
      `data: ${JSON.stringify({
        type: 'error',
        code: known ? err.code : 'INTERNAL',
        // A validation message is safe to show; a 500 can carry anything, and
        // telling them apart at this point is guesswork — the same reasoning
        // the client's error reporting uses (src/api/queryClient.ts).
        message: known ? err.message : 'Something went wrong',
      })}\n\n`
    )
    if (!known) console.error(err)
  }

  // A turn that yielded nothing at all still has to answer something.
  if (!opened) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.write(`data: ${JSON.stringify({ type: 'done', complete: false })}\n\n`)
  }
  res.end()
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const chatTripRouter = Router({ mergeParams: true })
chatTripRouter.use('/chat', requireChat)
chatTripRouter.get('/chat', read)
chatTripRouter.post('/chat/messages', turn)
