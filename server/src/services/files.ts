import type { DataStore } from '../lib/datastore.js'
import { ApiError, notFound } from '../lib/errors.js'

export async function listTripFiles(store: DataStore) {
  const trip = await store.getTrip()
  if (!trip) throw notFound('Trip')
  const files = await store.listFiles({ trip_id: trip.id })
  return {
    files: files.map(({ id, display_name, mime_type, size_bytes }) => ({
      id,
      display_name,
      mime_type,
      size_bytes,
    })),
  }
}

export async function getFileUrl(store: DataStore, fileId: string) {
  const file = await store.getFile(fileId)
  if (!file) throw notFound('File')
  const result = await store.getFileUrl(file)
  if (result === 'FILE_MISSING') {
    // distinct code (contracts/api.md): row exists but the blob is gone, so the
    // UI can explain instead of showing a blank screen
    throw new ApiError(404, 'FILE_MISSING', 'The stored file is missing or no longer available')
  }
  return result
}
