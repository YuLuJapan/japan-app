import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { asyncHandler, forbidden } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { tripContextOf } from '../lib/trip-context.js'
import {
  createShoppingItem,
  deleteShoppingItem,
  listShoppingItems,
  updateShoppingItem,
} from '../services/shopping.js'

const list = asyncHandler(async (req, res) => {
  res.json(await listShoppingItems(await getDataStore(), req.params.tripId))
})

const create = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json(await createShoppingItem(await getDataStore(), req.params.tripId, req.body ?? {}))
})

const update = asyncHandler(async (req, res) => {
  res.json(
    await updateShoppingItem(
      await getDataStore(),
      req.params.tripId,
      req.params.itemId,
      req.body ?? {}
    )
  )
})

const remove = asyncHandler(async (req, res) => {
  await deleteShoppingItem(await getDataStore(), req.params.tripId, req.params.itemId)
  res.status(204).end()
})

/**
 * The whole section, or none of it.
 *
 * The list is one thing a viewer may not be shown (lib/trip-view.ts), and
 * unlike the stays there is no partial version worth serving — a shopping item
 * *is* the secret. Mounted on the path rather than repeated per handler, so a
 * route added below inherits the check the way the trip guard works one level
 * up. Writers never reach the refusal: their view is full by construction.
 */
function requireShoppingView(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!tripContextOf(req).view.shopping) {
      throw forbidden('The shopping list is not part of your view of this trip')
    }
    next()
  } catch (err) {
    next(err)
  }
}

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const shoppingTripRouter = Router({ mergeParams: true })
shoppingTripRouter.use('/shopping', requireShoppingView)
shoppingTripRouter.get('/shopping', list)
shoppingTripRouter.post('/shopping', create)
shoppingTripRouter.patch('/shopping/:itemId', update)
shoppingTripRouter.delete('/shopping/:itemId', remove)
