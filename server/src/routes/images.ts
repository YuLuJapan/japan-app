import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { searchImages } from '../services/images.js'

export const imagesRouter = Router()

imagesRouter.get(
  '/images',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '')
    const limit = Math.min(Number(req.query.limit) || 8, 12)
    res.json({ results: await searchImages(q, limit) })
  })
)
