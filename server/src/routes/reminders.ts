import { Router } from 'express'
import type { Request } from 'express'
import { accessCode } from '../lib/auth.js'
import { getDataStore } from '../lib/datastore.js'
import { ApiError, asyncHandler } from '../lib/errors.js'
import {
  createReminder,
  deleteReminder,
  dispatchDueReminders,
  listReminders,
  updateReminder,
} from '../services/reminders.js'

/**
 * Only the cron dispatch endpoint lives here now. It is called by an external
 * scheduler with no trip in hand and guards itself with CRON_SECRET, so it is
 * the one reminder route that cannot be trip-scoped.
 */
export const remindersRouter = Router()

/**
 * The dispatch endpoint is called by an external scheduler, not by the app, so
 * it is exempt from authMiddleware and guards itself instead: `CRON_SECRET` as
 * a bearer token (what Vercel Cron sends) or as `?key=`. With no CRON_SECRET
 * set it falls back to the trip access code — never open.
 */
function assertCronAuthorized(req: Request) {
  const header = req.headers.authorization ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  const provided = bearer || String(req.query.key ?? '').trim()
  const secret = process.env.CRON_SECRET?.trim()
  const accepted = secret ? [secret, accessCode()] : [accessCode()]
  if (!provided || !accepted.includes(provided)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid cron secret')
  }
}

const dispatch = asyncHandler(async (req, res) => {
  assertCronAuthorized(req)
  res.json(await dispatchDueReminders(await getDataStore()))
})

// GET for simple cron pingers (cron-job.org, Vercel Cron), POST for everything else.
remindersRouter.get('/reminders/dispatch', dispatch)
remindersRouter.post('/reminders/dispatch', dispatch)

const list = asyncHandler(async (req, res) => {
  res.json(await listReminders(await getDataStore(), req.params.tripId))
})

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await createReminder(await getDataStore(), req.params.tripId, req.body))
})

const update = asyncHandler(async (req, res) => {
  res.json(
    await updateReminder(await getDataStore(), req.params.tripId, req.params.reminderId, req.body)
  )
})

const remove = asyncHandler(async (req, res) => {
  await deleteReminder(await getDataStore(), req.params.tripId, req.params.reminderId)
  res.status(204).end()
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const remindersTripRouter = Router({ mergeParams: true })
remindersTripRouter.get('/reminders', list)
remindersTripRouter.post('/reminders', create)
remindersTripRouter.patch('/reminders/:reminderId', update)
remindersTripRouter.delete('/reminders/:reminderId', remove)
