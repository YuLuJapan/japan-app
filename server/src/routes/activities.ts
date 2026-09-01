import { Router } from 'express'
import { tripContextOf } from '../lib/trip-context.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import {
  createActivity,
  deleteActivity,
  getActivityDetail,
  listActivities,
  updateActivity,
} from '../services/activities.js'

const list = asyncHandler(async (req, res) => {
  const view = tripContextOf(req).view
  res.json(
    await listActivities(await getDataStore(), req.params.tripId, {
      includeStays: view.stays,
      // A file count names no document, but it still says one exists — gated
      // on the same flag the documents section is.
      includeDocuments: view.documents,
    })
  )
})

const detail = asyncHandler(async (req, res) => {
  res.json(
    await getActivityDetail(await getDataStore(), req.params.tripId, req.params.activityId, {
      includeFiles: tripContextOf(req).view.documents,
      includeStays: tripContextOf(req).view.stays,
    })
  )
})

const create = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json(await createActivity(await getDataStore(), req.params.tripId, req.body ?? {}))
})

const update = asyncHandler(async (req, res) => {
  res.json(
    await updateActivity(
      await getDataStore(),
      req.params.tripId,
      req.params.activityId,
      req.body ?? {}
    )
  )
})

const remove = asyncHandler(async (req, res) => {
  await deleteActivity(await getDataStore(), req.params.tripId, req.params.activityId)
  res.status(204).end()
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const activitiesTripRouter = Router({ mergeParams: true })
activitiesTripRouter.get('/activities', list)
activitiesTripRouter.get('/activities/:activityId', detail)
activitiesTripRouter.post('/activities', create)
activitiesTripRouter.patch('/activities/:activityId', update)
activitiesTripRouter.delete('/activities/:activityId', remove)
