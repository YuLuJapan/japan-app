import { Router } from 'express'
import { accessOf, isGuest } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { searchAll } from '../services/search.js'

const search = asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? '')
  res.json(
    await searchAll(await getDataStore(), accessOf(req), q, { includeStays: !isGuest(req) })
  )
})

/** Legacy flat mount at /api. Removed once every client uses the nested form. */
export const searchRouter = Router()
searchRouter.get('/search', search)

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const searchTripRouter = Router({ mergeParams: true })
searchTripRouter.get('/search', search)
