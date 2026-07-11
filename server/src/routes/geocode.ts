import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { geocodeSearch } from '../services/geocode.js'

export const geocodeRouter = Router()

// GET /api/geocode?q=<text>&lat=<n>&lng=<n>
// Free OpenStreetMap place search; lat/lng bias results toward the current city.
geocodeRouter.get(
  '/geocode',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '')
    const lat = Number(req.query.lat)
    const lng = Number(req.query.lng)
    const bias =
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined
    res.json({ results: await geocodeSearch(q, bias) })
  })
)
