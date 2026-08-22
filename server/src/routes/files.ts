import { Router } from 'express'
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

const list = asyncHandler(async (req, res) => {
  res.json(await listTripDocuments(await getDataStore(), req.params.tripId))
})

const create = asyncHandler(async (req, res) => {
  res.status(201).json(await createFile(await getDataStore(), req.params.tripId, req.body ?? {}))
})

const fileUrl = asyncHandler(async (req, res) => {
  res.json(await getFileUrl(await getDataStore(), req.params.tripId, req.params.fileId))
})

// Streams the blob itself so the app can render it in the preview screen
// instead of handing the file off to the browser's downloader. `?download=1`
// flips the disposition for the preview's "Save" action.
const fileContent = asyncHandler(async (req, res) => {
  const { file, bytes, mime_type } = await getFileContent(
    await getDataStore(),
    req.params.tripId,
    req.params.fileId
  )
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

const remove = asyncHandler(async (req, res) => {
  await deleteFile(await getDataStore(), req.params.tripId, req.params.fileId)
  res.status(204).end()
})

/** Mounted under /api/trips/:tripId, behind requireTripAccess. */
export const filesTripRouter = Router({ mergeParams: true })
filesTripRouter.get('/files', list)
filesTripRouter.post('/files', create)
filesTripRouter.get('/files/:fileId/url', fileUrl)
filesTripRouter.get('/files/:fileId/content', fileContent)
filesTripRouter.delete('/files/:fileId', remove)
