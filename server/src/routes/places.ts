import { Router } from 'express'
import { accessOf, isGuest } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { createPlace, deletePlace, getPlaceDetail, updatePlace } from '../services/places.js'

export const placesRouter = Router()

placesRouter.get(
  '/places/:placeId',
  asyncHandler(async (req, res) => {
    res.json(
      await getPlaceDetail(await getDataStore(), accessOf(req), req.params.placeId, {
        includeFiles: !isGuest(req),
        includeStays: !isGuest(req),
      })
    )
  })
)

placesRouter.post(
  '/places',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createPlace(await getDataStore(), accessOf(req), req.body ?? {}))
  })
)

placesRouter.patch(
  '/places/:placeId',
  asyncHandler(async (req, res) => {
    res.json(await updatePlace(await getDataStore(), accessOf(req), req.params.placeId, req.body ?? {}))
  })
)

placesRouter.delete(
  '/places/:placeId',
  asyncHandler(async (req, res) => {
    await deletePlace(await getDataStore(), accessOf(req), req.params.placeId)
    res.status(204).end()
  })
)
