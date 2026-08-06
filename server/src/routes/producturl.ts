import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { previewProductUrl } from '../services/producturl.js'

export const productUrlRouter = Router()

productUrlRouter.get(
  '/product-preview',
  asyncHandler(async (req, res) => {
    const url = String(req.query.url ?? '')
    res.json(await previewProductUrl(await getDataStore(), url))
  })
)
