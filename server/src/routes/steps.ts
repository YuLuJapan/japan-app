// Journey steps: add/edit/remove the destinations + date ranges that make up
// the trip's schedule (the horizontal cards on the Journey page). Order is
// derived from start_date, not client-controlled.
import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { createStep, deleteStep, updateStep } from '../services/steps.js'

export const stepsRouter = Router()

stepsRouter.post(
  '/steps',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createStep(await getDataStore(), req.body ?? {}))
  })
)

stepsRouter.patch(
  '/steps/:stepId',
  asyncHandler(async (req, res) => {
    res.json(await updateStep(await getDataStore(), req.params.stepId, req.body ?? {}))
  })
)

stepsRouter.delete(
  '/steps/:stepId',
  asyncHandler(async (req, res) => {
    await deleteStep(await getDataStore(), req.params.stepId)
    res.status(204).end()
  })
)
