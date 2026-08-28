import { Router } from 'express'
import { tripContextOf } from '../lib/trip-context.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import {
  createItineraryItem,
  deleteItineraryItem,
  listItinerary,
  updateItineraryItem,
} from '../services/itinerary.js'

const list = asyncHandler(async (req, res) => {
  const view = tripContextOf(req).view
  res.json(
    await listItinerary(await getDataStore(), req.params.tripId, {
      includeStays: view.stays,
      // The plan's file tags name a document, so they are gated on the same
      // flag the documents section is — a withheld attachment must not
      // announce itself from the day plan instead.
      includeDocuments: view.documents,
    })
  )
})

const create = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json(await createItineraryItem(await getDataStore(), req.params.tripId, req.body ?? {}))
})

const update = asyncHandler(async (req, res) => {
  res.json(
    await updateItineraryItem(
      await getDataStore(),
      req.params.tripId,
      req.params.itemId,
      req.body ?? {}
    )
  )
})

const remove = asyncHandler(async (req, res) => {
  await deleteItineraryItem(await getDataStore(), req.params.tripId, req.params.itemId)
  res.status(204).end()
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const itineraryTripRouter = Router({ mergeParams: true })
itineraryTripRouter.get('/itinerary', list)
itineraryTripRouter.post('/itinerary', create)
itineraryTripRouter.patch('/itinerary/:itemId', update)
itineraryTripRouter.delete('/itinerary/:itemId', remove)
