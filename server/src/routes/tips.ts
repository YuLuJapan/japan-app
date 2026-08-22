import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { createTip, deleteTip, updateTip } from '../services/tips.js'

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await createTip(await getDataStore(), req.body ?? {}))
})

const update = asyncHandler(async (req, res) => {
  res.json(await updateTip(await getDataStore(), req.params.tipId, (req.body ?? {}).body))
})

const remove = asyncHandler(async (req, res) => {
  await deleteTip(await getDataStore(), req.params.tipId)
  res.status(204).end()
})

/** Legacy flat mount at /api. Removed once every client uses the nested form. */
export const tipsRouter = Router()
tipsRouter.post('/tips', create)
tipsRouter.patch('/tips/:tipId', update)
tipsRouter.delete('/tips/:tipId', remove)

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const tipsTripRouter = Router({ mergeParams: true })
tipsTripRouter.post('/tips', create)
tipsTripRouter.patch('/tips/:tipId', update)
tipsTripRouter.delete('/tips/:tipId', remove)
