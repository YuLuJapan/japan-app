import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { createPlace, deletePlace, getPlaceDetail, updatePlace } from '../services/places.js'

export const placesRouter = Router()

placesRouter.get(
  '/places/:placeId',
  asyncHandler(async (req, res) => {
    res.json(await getPlaceDetail(await getDataStore(), req.params.placeId))
  })
)

placesRouter.post(
  '/places',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createPlace(await getDataStore(), req.body ?? {}))
  })
)

placesRouter.patch(
  '/places/:placeId',
  asyncHandler(async (req, res) => {
    res.json(await updatePlace(await getDataStore(), req.params.placeId, req.body ?? {}))
  })
)

placesRouter.delete(
  '/places/:placeId',
  asyncHandler(async (req, res) => {
    await deletePlace(await getDataStore(), req.params.placeId)
    res.status(204).end()
  })
)
