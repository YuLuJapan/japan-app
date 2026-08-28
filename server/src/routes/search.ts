import { Router } from 'express'
import { tripContextOf } from '../lib/trip-context.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { searchAll } from '../services/search.js'

const search = asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? '')
  res.json(
    await searchAll(await getDataStore(), req.params.tripId, q, {
      includeStays: tripContextOf(req).view.stays,
    })
  )
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const searchTripRouter = Router({ mergeParams: true })
searchTripRouter.get('/search', search)
