// GET /api/me — the signed-in account, as the app knows it.
//
// Also what the gate calls to confirm a fresh token before it navigates: a 401
// here means the API did not accept the session, whatever Supabase said.
import { Router } from 'express'
import { currentUser } from '../lib/auth.js'
import { getDataStore } from '../lib/datastore.js'
import { asyncHandler } from '../lib/errors.js'

export const meRouter = Router()

meRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = currentUser(req)
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
    })
  })
)
