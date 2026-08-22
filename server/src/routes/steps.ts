// Journey steps: add/edit/remove the destinations + date ranges that make up
// the trip's schedule (the horizontal cards on the Journey page). Order is
// derived from start_date, not client-controlled.
import { Router } from 'express'
import { accessOf } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { createStep, deleteStep, updateStep } from '../services/steps.js'

const create = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json(await createStep(await getDataStore(), accessOf(req), req.body ?? {}, req.params.tripId))
})

const update = asyncHandler(async (req, res) => {
  res.json(await updateStep(await getDataStore(), req.params.stepId, req.body ?? {}))
})

const remove = asyncHandler(async (req, res) => {
  await deleteStep(await getDataStore(), req.params.stepId)
  res.status(204).end()
})

/** Legacy flat mount at /api. Removed once every client uses the nested form. */
export const stepsRouter = Router()
stepsRouter.post('/steps', create)
stepsRouter.patch('/steps/:stepId', update)
stepsRouter.delete('/steps/:stepId', remove)

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const stepsTripRouter = Router({ mergeParams: true })
stepsTripRouter.post('/steps', create)
stepsTripRouter.patch('/steps/:stepId', update)
stepsTripRouter.delete('/steps/:stepId', remove)
