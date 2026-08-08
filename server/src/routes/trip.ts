import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import {
  createTrip,
  deleteTrip,
  getDefaultTripBundle,
  getTripBundle,
  listTrips,
  updateTrip,
} from '../services/trips.js'

export const tripRouter = Router()

// Legacy, pre-multi-trip route: the oldest trip's bundle. Kept so the current
// (single-trip) frontend keeps working unchanged; superseded by
// GET /api/trips/:tripId once the UI can pick a trip.
tripRouter.get(
  '/trip',
  asyncHandler(async (_req, res) => {
    res.json(await getDefaultTripBundle(await getDataStore()))
  })
)

tripRouter.get(
  '/trips',
  asyncHandler(async (_req, res) => {
    res.json(await listTrips(await getDataStore()))
  })
)

tripRouter.post(
  '/trips',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createTrip(await getDataStore(), req.body ?? {}))
  })
)

tripRouter.get(
  '/trips/:tripId',
  asyncHandler(async (req, res) => {
    res.json(await getTripBundle(await getDataStore(), req.params.tripId))
  })
)

tripRouter.patch(
  '/trips/:tripId',
  asyncHandler(async (req, res) => {
    res.json(await updateTrip(await getDataStore(), req.params.tripId, req.body ?? {}))
  })
)

tripRouter.delete(
  '/trips/:tripId',
  asyncHandler(async (req, res) => {
    await deleteTrip(await getDataStore(), req.params.tripId)
    res.status(204).end()
  })
)
