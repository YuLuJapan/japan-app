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

export const shoppingRouter = Router()

shoppingRouter.get(
  '/shopping',
  asyncHandler(async (req, res) => {
    res.json(await listShoppingItems(await getDataStore(), accessOf(req)))
  })
)

shoppingRouter.post(
  '/shopping',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createShoppingItem(await getDataStore(), accessOf(req), req.body ?? {}))
  })
)

shoppingRouter.get(
  '/trips/:tripId/shopping',
  asyncHandler(async (req, res) => {
    res.json(await listShoppingItems(await getDataStore(), accessOf(req), req.params.tripId))
  })
)

shoppingRouter.post(
  '/trips/:tripId/shopping',
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(await createShoppingItem(await getDataStore(), accessOf(req), req.body ?? {}, req.params.tripId))
  })
)

shoppingRouter.patch(
  '/shopping/:itemId',
  asyncHandler(async (req, res) => {
    res.json(await updateShoppingItem(await getDataStore(), req.params.itemId, req.body ?? {}))
  })
)

shoppingRouter.delete(
  '/shopping/:itemId',
  asyncHandler(async (req, res) => {
    await deleteShoppingItem(await getDataStore(), req.params.itemId)
    res.status(204).end()
  })
)
