import { Router, type Request } from 'express'
import { accessOf } from '../lib/auth.js'
import { tripContextOf } from '../lib/trip-context.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import {
  createTrip,
  deleteTrip,
  getDateImpact,
  getTripBundle,
  listTrips,
  updateTrip,
} from '../services/trips.js'

/**
 * What this caller is shown on the bundle. A restricted viewer loses the
 * flight (booking reference, ticket numbers) and the stay counts that would
 * otherwise put a "Stays" card on every city — see lib/trip-view.ts.
 */
const bundleView = (req: Request) => ({
  includeFlight: tripContextOf(req).view.flight,
  includeStays: tripContextOf(req).view.stays,
})

const bundle = asyncHandler(async (req, res) => {
  res.json(
    await getTripBundle(await getDataStore(), accessOf(req), req.params.tripId, bundleView(req))
  )
})

// GET .../date-impact?start_date=&end_date=
// Dry run for a date change: which stops and activities it would strand.
const dateImpact = asyncHandler(async (req, res) => {
  const pick = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  res.json(
    await getDateImpact(await getDataStore(), accessOf(req), req.params.tripId, {
      start_date: pick(req.query.start_date),
      end_date: pick(req.query.end_date),
    })
  )
})

const update = asyncHandler(async (req, res) => {
  res.json(await updateTrip(await getDataStore(), accessOf(req), req.params.tripId, req.body ?? {}))
})

const remove = asyncHandler(async (req, res) => {
  await deleteTrip(await getDataStore(), accessOf(req), req.params.tripId)
  res.status(204).end()
})

/**
 * The trip collection, mounted at /api. Not trip-scoped by definition: listing
 * and creating happen before there is a trip to be a member of.
 */
export const tripRouter = Router()

tripRouter.get(
  '/trips',
  asyncHandler(async (req, res) => {
    res.json(await listTrips(await getDataStore(), accessOf(req)))
  })
)

tripRouter.post(
  '/trips',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createTrip(await getDataStore(), accessOf(req), req.body ?? {}))
  })
)

/**
 * The trip itself, mounted under /api/trips/:tripId behind requireTripAccess.
 * `''` is the bundle — GET /api/trips/:tripId.
 */
export const tripDetailRouter = Router({ mergeParams: true })
tripDetailRouter.get('/', bundle)
tripDetailRouter.get('/date-impact', dateImpact)
tripDetailRouter.patch('/', update)
tripDetailRouter.delete('/', remove)
