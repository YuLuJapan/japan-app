import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { getRatesFor } from '../services/rates.js'
import { CURRENCIES, CURRENCY_BY_COUNTRY } from '../lib/currencies.js'

export const ratesRouter = Router()

// GET /api/rates?base=JPY&symbols=USD,ILS
// Both optional: base defaults to JPY (what every trip was before the currency
// could be chosen) and no symbols means every rate the provider quotes.
ratesRouter.get(
  '/rates',
  asyncHandler(async (req, res) => {
    const pick = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
    res.json(
      await getRatesFor(await getDataStore(), {
        base: pick(req.query.base),
        symbols: pick(req.query.symbols),
      })
    )
  })
)

// The currencies a trip can be priced in, and the guess to make from a country.
// Static, but served rather than duplicated in the client — the list that fills
// the trip sheet's pickers is the same one that validates what they save.
ratesRouter.get(
  '/currencies',
  asyncHandler(async (_req, res) => {
    res.json({ currencies: CURRENCIES, by_country: CURRENCY_BY_COUNTRY })
  })
)
