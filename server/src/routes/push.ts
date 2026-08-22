import { Router } from 'express'
import { currentUser } from '../lib/auth.js'
import { getDataStore } from '../lib/datastore.js'
import { asyncHandler } from '../lib/errors.js'
import {
  getPushKey,
  registerPushSubscription,
  removePushSubscription,
  sendTestPush,
} from '../services/push.js'

export const pushRouter = Router()

pushRouter.get(
  '/push/key',
  asyncHandler(async (_req, res) => {
    res.json(getPushKey())
  })
)

pushRouter.post(
  '/push/subscriptions',
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(await registerPushSubscription(await getDataStore(), currentUser(req).id, req.body))
  })
)

// The endpoint is a long URL, so it travels as a query param rather than a body
// (DELETE bodies are awkward for both fetch and Express).
pushRouter.delete(
  '/push/subscriptions',
  asyncHandler(async (req, res) => {
    await removePushSubscription(await getDataStore(), currentUser(req).id, req.query.endpoint)
    res.status(204).end()
  })
)

pushRouter.post(
  '/push/test',
  asyncHandler(async (req, res) => {
    res.json(await sendTestPush(await getDataStore(), currentUser(req).id))
  })
)
