import { Router } from 'express'
import { getDataStore } from '../lib/datastore.js'
import { asyncHandler } from '../lib/errors.js'
import { tripContextOf } from '../lib/trip-context.js'
import { buildTripExport } from '../services/export.js'

/**
 * GET /export?detail=share|full
 *
 * Read-only, and deliberately the *only* export route: the bytes are produced
 * on the device (research R1), so there is nothing here that returns a file,
 * nothing stored and nothing to expire.
 *
 * No role check. Every member may export, viewers included (FR-007) — the
 * payload is a strict subset of what the caller can already read elsewhere,
 * which is enforced by handing `view` to the projection.
 */
const tripExport = asyncHandler(async (req, res) => {
  const context = tripContextOf(req)
  res.json(await buildTripExport(await getDataStore(), context, req.query.detail, req.query.ids))
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const exportTripRouter = Router({ mergeParams: true })
exportTripRouter.get('/export', tripExport)
