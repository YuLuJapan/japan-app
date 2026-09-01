import { Router } from 'express'
import { tripContextOf } from '../lib/trip-context.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { getZoneDetail, updateZone } from '../services/zones.js'

const zoneDetail = asyncHandler(async (req, res) => {
  res.json(
    await getZoneDetail(await getDataStore(), req.params.tripId, req.params.zoneId, {
      includeFiles: tripContextOf(req).view.documents,
    })
  )
})

const update = asyncHandler(async (req, res) => {
  res.json(
    await updateZone(await getDataStore(), req.params.tripId, req.params.zoneId, req.body ?? {})
  )
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const zonesTripRouter = Router({ mergeParams: true })
zonesTripRouter.get('/zones/:zoneId', zoneDetail)
zonesTripRouter.patch('/zones/:zoneId', update)
