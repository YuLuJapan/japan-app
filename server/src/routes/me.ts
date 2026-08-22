// GET /api/me — the signed-in account, as the app knows it.
//
// `user` is null for the deprecated static access codes: they prove a right,
// not an identity, and there is nobody to name. The frontend uses that to tell
// "signed in as Yuval" apart from "holding the trip's access code".
import { Router } from 'express'
import { currentUser } from '../lib/auth.js'
import { getDataStore } from '../lib/datastore.js'
import { asyncHandler } from '../lib/errors.js'

export const meRouter = Router()

meRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = currentUser(req)
    if (!user) {
      res.json({ user: null, role: req.role })
      return
    }
    // Prefer the stored row (a display_name the user edited beats the one the
    // provider last sent), falling back to the token when the profiles table
    // isn't migrated yet and syncProfile quietly did nothing.
    const profile = await (await getDataStore()).getProfile(user.id)
    res.json({
      user: profile ?? {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
      },
      role: req.role,
    })
  })
)
