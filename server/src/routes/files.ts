import { Router } from 'express'
import { accessOf } from '../lib/auth.js'
import { asyncHandler } from '../lib/errors.js'
import { getDataStore } from '../lib/datastore.js'
import {
  createFile,
  deleteFile,
  downloadName,
  getFileContent,
  getFileUrl,
  listTripDocuments,
} from '../services/files.js'

export const filesRouter = Router()

filesRouter.get(
  '/files',
  asyncHandler(async (req, res) => {
    res.json(await listTripDocuments(await getDataStore(), accessOf(req)))
  })
)

filesRouter.post(
  '/files',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createFile(await getDataStore(), accessOf(req), req.body ?? {}))
  })
)

filesRouter.get(
  '/trips/:tripId/files',
  asyncHandler(async (req, res) => {
    res.json(await listTripDocuments(await getDataStore(), accessOf(req), req.params.tripId))
  })
)

filesRouter.post(
  '/trips/:tripId/files',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createFile(await getDataStore(), accessOf(req), req.body ?? {}, req.params.tripId))
  })
)

filesRouter.get(
  '/files/:fileId/url',
  asyncHandler(async (req, res) => {
    res.json(await getFileUrl(await getDataStore(), req.params.fileId))
  })
)

// Streams the blob itself so the app can render it in the preview screen
// instead of handing the file off to the browser's downloader. `?download=1`
// flips the disposition for the preview's "Save" action.
filesRouter.get(
  '/files/:fileId/content',
  asyncHandler(async (req, res) => {
    const { file, bytes, mime_type } = await getFileContent(await getDataStore(), req.params.fileId)
    const name = downloadName(file)
    const disposition = req.query.download === '1' ? 'attachment' : 'inline'
    res.setHeader('Content-Type', mime_type)
    res.setHeader('Content-Length', String(bytes.length))
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`
    )
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(bytes)
  })
)

filesRouter.delete(
  '/files/:fileId',
  asyncHandler(async (req, res) => {
    await deleteFile(await getDataStore(), req.params.fileId)
    res.status(204).end()
  })
)
