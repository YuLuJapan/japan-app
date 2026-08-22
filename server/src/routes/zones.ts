import { Router } from 'express'
import { isGuest } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { getZoneDetail, listZonePlaces } from '../services/zones.js'

const zoneDetail = asyncHandler(async (req, res) => {
  res.json(
    await getZoneDetail(await getDataStore(), req.params.tripId, req.params.zoneId, {
      includeFiles: !isGuest(req),
      includeStays: !isGuest(req),
    })
  )
})

const zonePlaces = asyncHandler(async (req, res) => {
  const category = String(req.query.category ?? '')
  res.json(
    await listZonePlaces(await getDataStore(), req.params.tripId, req.params.zoneId, category, {
      includeStays: !isGuest(req),
    })
  )
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const zonesTripRouter = Router({ mergeParams: true })
zonesTripRouter.get('/zones/:zoneId', zoneDetail)
zonesTripRouter.get('/zones/:zoneId/places', zonePlaces)
