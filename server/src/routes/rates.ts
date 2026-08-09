import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { getRates } from '../services/rates.js'
import { isCurrencyCode } from '../lib/currency.js'
import { validation } from '../lib/errors.js'

export const ratesRouter = Router()

ratesRouter.get(
  '/rates',
  asyncHandler(async (req, res) => {
    const { base } = req.query
    if (base !== undefined && !isCurrencyCode(base)) {
      throw validation(['base must be a supported currency code'])
    }
    res.json(await getRates(await getDataStore(), base))
  })
)
