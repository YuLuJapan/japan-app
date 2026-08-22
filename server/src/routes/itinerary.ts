import { Router } from 'express'
import { accessOf, isGuest } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import {
  createItineraryItem,
  deleteItineraryItem,
  listItinerary,
  updateItineraryItem,
} from '../services/itinerary.js'

// `req.params.tripId` is undefined on the flat mount and set on the nested one,
// which is exactly what resolveTrip expects — so one handler serves both.
const list = asyncHandler(async (req, res) => {
  res.json(
    await listItinerary(await getDataStore(), accessOf(req), req.params.tripId, {
      includeStays: !isGuest(req),
    })
  )
})

const create = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json(
      await createItineraryItem(
        await getDataStore(),
        accessOf(req),
        req.body ?? {},
        req.params.tripId
      )
    )
})

const update = asyncHandler(async (req, res) => {
  res.json(await updateItineraryItem(await getDataStore(), req.params.itemId, req.body ?? {}))
})

const remove = asyncHandler(async (req, res) => {
  await deleteItineraryItem(await getDataStore(), req.params.itemId)
  res.status(204).end()
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const itineraryTripRouter = Router({ mergeParams: true })
itineraryTripRouter.get('/itinerary', list)
itineraryTripRouter.post('/itinerary', create)
itineraryTripRouter.patch('/itinerary/:itemId', update)
itineraryTripRouter.delete('/itinerary/:itemId', remove)
