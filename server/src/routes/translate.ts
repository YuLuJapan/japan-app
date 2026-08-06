import { Router } from 'express'
import { asyncHandler, validation } from '../lib/errors.js'
import { containsJapanese, translateJaToEn } from '../services/translate.js'

export const translateRouter = Router()

translateRouter.get(
  '/translate',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim()
    if (!q) throw validation(['q is required'])
    res.json({
      text: q,
      is_japanese: containsJapanese(q),
      translated: await translateJaToEn(q),
    })
  })
)
