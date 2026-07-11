import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { createTip, deleteTip, updateTip } from '../services/tips.js'

export const tipsRouter = Router()

tipsRouter.post(
  '/tips',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createTip(await getDataStore(), req.body ?? {}))
  })
)

tipsRouter.patch(
  '/tips/:tipId',
  asyncHandler(async (req, res) => {
    res.json(await updateTip(await getDataStore(), req.params.tipId, (req.body ?? {}).body))
  })
)

tipsRouter.delete(
  '/tips/:tipId',
  asyncHandler(async (req, res) => {
    await deleteTip(await getDataStore(), req.params.tipId)
    res.status(204).end()
  })
)
