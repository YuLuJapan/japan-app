import { Router } from 'express'
import { roleForToken } from '../lib/auth.js'
import { ApiError, asyncHandler } from '../lib/errors.js'

export const authRouter = Router()

authRouter.post(
  '/auth/verify',
  asyncHandler(async (req, res) => {
    const { code } = (req.body ?? {}) as { code?: string }
    const role = typeof code === 'string' ? await roleForToken(code.trim()) : null
    if (!role) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Wrong access code')
    }
    res.json({ ok: true, role })
  })
)

// What the code in this browser is worth. The gate already learns the role at
// sign-in, but sessions outlive deploys — anyone signed in before the guest
// view existed has a stored code and no stored role, and asks here instead of
// being bounced back to the gate.
authRouter.get(
  '/auth/session',
  asyncHandler(async (req, res) => {
    res.json({ role: req.role })
  })
)
