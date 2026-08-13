import { Router, type Request } from 'express'
import { isGuest } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import {
  createTrip,
  deleteTrip,
  getDateImpact,
  getDefaultTripBundle,
  getTripBundle,
  listTrips,
  updateTrip,
} from '../services/trips.js'

export const tripRouter = Router()

/** Guests get the bundle without the flight and without the stay counts. */
const guestView = (req: Request) => ({
  includeFlight: !isGuest(req),
  includeStays: !isGuest(req),
})

// Legacy, pre-multi-trip route: the oldest trip's bundle. Kept so the current
// (single-trip) frontend keeps working unchanged; superseded by
// GET /api/trips/:tripId once the UI can pick a trip.
tripRouter.get(
  '/trip',
  asyncHandler(async (req, res) => {
    res.json(await getDefaultTripBundle(await getDataStore(), guestView(req)))
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
    res.json(await getTripBundle(await getDataStore(), req.params.tripId, guestView(req)))
  })
)

// GET /api/trips/:tripId/date-impact?start_date=&end_date=
// Dry run for a date change: which stops and activities it would strand.
tripRouter.get(
  '/trips/:tripId/date-impact',
  asyncHandler(async (req, res) => {
    const pick = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
    res.json(
      await getDateImpact(await getDataStore(), req.params.tripId, {
        start_date: pick(req.query.start_date),
        end_date: pick(req.query.end_date),
      })
    )
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
