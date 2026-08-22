import { Router } from 'express'
import { accessOf } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import {
  createShoppingItem,
  deleteShoppingItem,
  listShoppingItems,
  updateShoppingItem,
} from '../services/shopping.js'

const list = asyncHandler(async (req, res) => {
  res.json(await listShoppingItems(await getDataStore(), accessOf(req), req.params.tripId))
})

const create = asyncHandler(async (req, res) => {
  res
    .status(201)
    .json(
      await createShoppingItem(
        await getDataStore(),
        accessOf(req),
        req.body ?? {},
        req.params.tripId
      )
    )
})

const update = asyncHandler(async (req, res) => {
  res.json(await updateShoppingItem(await getDataStore(), req.params.itemId, req.body ?? {}))
})

const remove = asyncHandler(async (req, res) => {
  await deleteShoppingItem(await getDataStore(), req.params.itemId)
  res.status(204).end()
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const shoppingTripRouter = Router({ mergeParams: true })
shoppingTripRouter.get('/shopping', list)
shoppingTripRouter.post('/shopping', create)
shoppingTripRouter.patch('/shopping/:itemId', update)
shoppingTripRouter.delete('/shopping/:itemId', remove)
