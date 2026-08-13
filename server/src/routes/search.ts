import { Router } from 'express'
import { isGuest } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { searchAll } from '../services/search.js'

export const searchRouter = Router()

searchRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '')
    res.json(await searchAll(await getDataStore(), q, { includeStays: !isGuest(req) }))
  })
)
