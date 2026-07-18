import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { geocodeSearch } from '../services/geocode.js'

export const geocodeRouter = Router()

// GET /api/geocode?q=<text>&lat=<n>&lng=<n>&global=1
// Free OpenStreetMap place search; lat/lng bias results toward the current
// city. Restricted to Japan by default; global=1 searches worldwide (used by
// the journey destination search, since a trip can include non-Japan stops).
geocodeRouter.get(
  '/geocode',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '')
    const lat = Number(req.query.lat)
    const lng = Number(req.query.lng)
    const bias =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined
    const global = req.query.global === '1'
    res.json({ results: await geocodeSearch(q, bias, { global }) })
  })
)
