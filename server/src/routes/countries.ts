import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { COUNTRIES } from '../lib/countries.js'

export const countriesRouter = Router()

// The countries a trip can be going to.
//
// Static, but served rather than duplicated in the client — the list filling the
// trip sheet's picker is the same one that validates what it saves, exactly as
// GET /api/currencies already is for currency codes.
//
// Reference data, so it mounts beside that one: under authMiddleware, and
// deliberately outside the trip-scoped router. It returns no trip content, and
// hanging it off /api/trips/:tripId would give it an access check it does not
// need and imply per-trip data it is not.
countriesRouter.get(
  '/countries',
  asyncHandler(async (_req, res) => {
    res.json({ countries: COUNTRIES })
  })
)
