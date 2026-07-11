import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { getTripBundle } from '../services/trips.js'

export const tripRouter = Router()

tripRouter.get(
  '/trip',
  asyncHandler(async (_req, res) => {
    res.json(await getTripBundle(await getDataStore()))
  })
)
