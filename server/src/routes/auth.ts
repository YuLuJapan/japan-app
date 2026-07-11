import { Router } from 'express'
import { accessCode } from '../lib/auth.js'
import { ApiError, asyncHandler } from '../lib/errors.js'

export const authRouter = Router()

authRouter.post(
  '/auth/verify',
  asyncHandler(async (req, res) => {
    const { code } = (req.body ?? {}) as { code?: string }
    if (typeof code !== 'string' || code.trim() !== accessCode()) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Wrong access code')
    }
    res.json({ ok: true })
  })
)
