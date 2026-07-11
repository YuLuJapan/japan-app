import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import {
  createItineraryItem,
  deleteItineraryItem,
  listItinerary,
  updateItineraryItem,
} from '../services/itinerary.js'

export const itineraryRouter = Router()

itineraryRouter.get(
  '/itinerary',
  asyncHandler(async (_req, res) => {
    res.json(await listItinerary(await getDataStore()))
  })
)

itineraryRouter.post(
  '/itinerary',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createItineraryItem(await getDataStore(), req.body ?? {}))
  })
)

itineraryRouter.patch(
  '/itinerary/:itemId',
  asyncHandler(async (req, res) => {
    res.json(await updateItineraryItem(await getDataStore(), req.params.itemId, req.body ?? {}))
  })
)

itineraryRouter.delete(
  '/itinerary/:itemId',
  asyncHandler(async (req, res) => {
    await deleteItineraryItem(await getDataStore(), req.params.itemId)
    res.status(204).end()
  })
)
