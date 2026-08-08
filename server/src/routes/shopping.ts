import { Router } from 'express'
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
  asyncHandler(async (_req, res) => {
    res.json(await listShoppingItems(await getDataStore()))
  })
)

shoppingRouter.post(
  '/shopping',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createShoppingItem(await getDataStore(), req.body ?? {}))
  })
)

shoppingRouter.get(
  '/trips/:tripId/shopping',
  asyncHandler(async (req, res) => {
    res.json(await listShoppingItems(await getDataStore(), req.params.tripId))
  })
)

shoppingRouter.post(
  '/trips/:tripId/shopping',
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(await createShoppingItem(await getDataStore(), req.body ?? {}, req.params.tripId))
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
