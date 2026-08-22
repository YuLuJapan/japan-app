import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
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

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const shoppingTripRouter = Router({ mergeParams: true })
shoppingTripRouter.get('/shopping', list)
shoppingTripRouter.post('/shopping', create)
shoppingTripRouter.patch('/shopping/:itemId', update)
shoppingTripRouter.delete('/shopping/:itemId', remove)
