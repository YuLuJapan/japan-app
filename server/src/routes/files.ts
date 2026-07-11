import { Router } from 'express'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import { getFileUrl, listTripFiles } from '../services/files.js'

export const filesRouter = Router()

filesRouter.get(
  '/files',
  asyncHandler(async (_req, res) => {
    res.json(await listTripFiles(await getDataStore()))
  })
)

filesRouter.get(
  '/files/:fileId/url',
  asyncHandler(async (req, res) => {
    res.json(await getFileUrl(await getDataStore(), req.params.fileId))
  })
)
