import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getRates } from '../services/rates.js'

export const ratesRouter = Router()

ratesRouter.get(
  '/rates',
  asyncHandler(async (_req, res) => {
    res.json(await getRates())
  })
)
