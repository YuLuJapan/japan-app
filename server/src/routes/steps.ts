// Journey steps: add/edit/remove the destinations + date ranges that make up
// the trip's schedule (the horizontal cards on the Journey page). Order is
// derived from start_date, not client-controlled.
import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { tripContextOf } from '../lib/trip-context.js'
import { createStep, deleteStep, updateStep } from '../services/steps.js'

const create = asyncHandler(async (req, res) => {
  // The step comes back as the journey card renders it, counts included — so
  // the view decides whether stays are counted, exactly as on the bundle.
  const { stays } = tripContextOf(req).view
  res.status(201).json(
    await createStep(await getDataStore(), req.params.tripId, req.body ?? {}, {
      includeStays: stays,
    })
  )
})

const update = asyncHandler(async (req, res) => {
  const { stays } = tripContextOf(req).view
  res.json(
    await updateStep(await getDataStore(), req.params.tripId, req.params.stepId, req.body ?? {}, {
      includeStays: stays,
    })
  )
})

const remove = asyncHandler(async (req, res) => {
  await deleteStep(await getDataStore(), req.params.tripId, req.params.stepId)
  res.status(204).end()
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const stepsTripRouter = Router({ mergeParams: true })
stepsTripRouter.post('/steps', create)
stepsTripRouter.patch('/steps/:stepId', update)
stepsTripRouter.delete('/steps/:stepId', remove)
