// GET /api/me — the signed-in account, as the app knows it.
//
// Also what the gate calls to confirm a fresh token before it navigates: a 401
// here means the API did not accept the session, whatever Supabase said.
import { Router } from 'express'
import { currentUser } from '../lib/auth.js'
import { getDataStore } from '../lib/datastore.js'
import { asyncHandler } from '../lib/errors.js'
import { CURRENT_TERMS_VERSION } from '../lib/terms.js'

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
      // The client is told *whether* it is current, never which version to
      // send — so there is one source of truth and no way to accept a version
      // that isn't the one being served.
      terms: {
        accepted: profile?.accepted_terms_version === CURRENT_TERMS_VERSION,
        version: CURRENT_TERMS_VERSION,
      },
    })
  })
)

/**
 * Record that this account accepts the terms as they currently stand.
 *
 * The server stamps its own version rather than trusting one from the body:
 * a client that sent a version string could otherwise "accept" text nobody
 * ever showed it. Idempotent — accepting twice just moves the timestamp.
 */
meRouter.post(
  '/me/terms',
  asyncHandler(async (req, res) => {
    const user = currentUser(req)
    const store = await getDataStore()
    // syncProfile is best-effort and cached, so the row may not exist yet on a
    // brand-new account; make sure there is something to stamp.
    await store.upsertProfile({
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
    })
    const profile = await store.acceptTerms(
      user.id,
      CURRENT_TERMS_VERSION,
      new Date().toISOString()
    )
    res.json({
      user: profile,
      terms: { accepted: true, version: CURRENT_TERMS_VERSION },
    })
  })
)
