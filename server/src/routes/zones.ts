import { Router } from 'express'
import { isGuest } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { getZoneDetail, listZonePlaces } from '../services/zones.js'

export const zonesRouter = Router()

zonesRouter.get(
  '/zones/:zoneId',
  asyncHandler(async (req, res) => {
    res.json(
      await getZoneDetail(await getDataStore(), req.params.zoneId, {
        includeFiles: !isGuest(req),
        includeStays: !isGuest(req),
      })
    )
  })
)

zonesRouter.get(
  '/zones/:zoneId/places',
  asyncHandler(async (req, res) => {
    const category = String(req.query.category ?? '')
    res.json(
      await listZonePlaces(await getDataStore(), req.params.zoneId, category, {
        includeStays: !isGuest(req),
      })
    )
  })
)
