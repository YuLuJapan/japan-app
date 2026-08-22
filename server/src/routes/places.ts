import { Router } from 'express'
import { accessOf, isGuest } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { createPlace, deletePlace, getPlaceDetail, updatePlace } from '../services/places.js'

const placeDetail = asyncHandler(async (req, res) => {
  res.json(
    await getPlaceDetail(await getDataStore(), accessOf(req), req.params.placeId, {
      includeFiles: !isGuest(req),
      includeStays: !isGuest(req),
    })
  )
})

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await createPlace(await getDataStore(), accessOf(req), req.body ?? {}))
})

const update = asyncHandler(async (req, res) => {
  res.json(
    await updatePlace(await getDataStore(), accessOf(req), req.params.placeId, req.body ?? {})
  )
})

const remove = asyncHandler(async (req, res) => {
  await deletePlace(await getDataStore(), accessOf(req), req.params.tripId, req.params.placeId)
  res.status(204).end()
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const placesTripRouter = Router({ mergeParams: true })
placesTripRouter.get('/places/:placeId', placeDetail)
placesTripRouter.post('/places', create)
placesTripRouter.patch('/places/:placeId', update)
placesTripRouter.delete('/places/:placeId', remove)
