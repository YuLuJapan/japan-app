import { randomUUID } from 'node:crypto'
import type { DataStore, FileAttachment } from '../lib/datastore.js'
import { requireTrip } from '../lib/access.js'
import { STAY_CATEGORY, type TripView } from '../lib/trip-view.js'
import { ApiError, notFound, validation } from '../lib/errors.js'

const MAX_BYTES = 3 * 1024 * 1024 // 3 MB — stays under Vercel's request-body limit once base64-encoded

// Accepted types → storage extension. Reservations are PDFs or photos.
const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
}

const meta = ({ id, display_name, mime_type, size_bytes }: FileAttachment) => ({
  id,
  display_name,
  mime_type,
  size_bytes,
})

// row exists but the blob is gone → distinct code (contracts/api.md) so the UI
// can explain instead of showing a blank screen
const fileMissing = () =>
  new ApiError(404, 'FILE_MISSING', 'The stored file is missing or no longer available')

/** display_name with the extension its mime type implies, for Content-Disposition. */
export function downloadName(file: FileAttachment) {
  const ext = EXT_BY_MIME[file.mime_type] ?? file.storage_path.split('.').pop() ?? 'bin'
  // strip characters that would break the header or escape a directory
  const base = file.display_name.replace(/[\\/"\p{Cc}]/gu, '').trim() || 'document'
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`
}

/**
 * The Documents tab.
 *
 * Two visibility rules meet here, and only one of them can be exact:
 *
 * - A file hanging off a **place** inherits that place's visibility, so a
 *   hotel's reservation PDF disappears exactly when the stays do. Mechanical,
 *   no guessing.
 * - A file hanging off the **trip or a zone** is governed solely by
 *   `view.documents`. "flight booking.pdf" attached to the trip is a blob with
 *   a display name; the app cannot know what is inside it, so `flight: false`
 *   with `documents: true` still shows it. The members screen says so rather
 *   than pretending otherwise — the same reasoning as withholding a whole
 *   category instead of redacting prose.
 */
/**
 * Where a file hangs, named — the half of a document row that is not the file.
 *
 * The Documents tab groups by this, and the name is the zone's or the place's,
 * so it cannot be assembled from the file alone. `listTripDocuments` used to
 * build it inline, which left create and rename answering with something
 * narrower than the list they change; both go through here now.
 */
type NameCache = Map<string, string>

async function attachedTo(
  store: DataStore,
  tripId: string,
  file: FileAttachment,
  names: NameCache = new Map()
) {
  // Keyed by kind as well as id, so a zone and an activity can never collide.
  const named = async (key: string, look: () => Promise<string>) => {
    if (!names.has(key)) names.set(key, await look())
    return names.get(key)!
  }
  if (file.activity_id) {
    const id = file.activity_id
    const name = await named(
      `activity:${id}`,
      async () => (await store.getActivity(tripId, id))?.name ?? 'Activity'
    )
    return { kind: 'activity' as const, id, name }
  }
  if (file.zone_id) {
    const id = file.zone_id
    const name = await named(
      `zone:${id}`,
      async () => (await store.getZone(tripId, id))?.name ?? 'City'
    )
    return { kind: 'zone' as const, id, name }
  }
  return { kind: 'trip' as const, id: tripId, name: 'Trip' }
}

/** A file as the Documents tab lists it: its meta plus where it hangs. */
export async function documentView(
  store: DataStore,
  tripId: string,
  file: FileAttachment,
  names?: NameCache
) {
  return { ...meta(file), attached_to: await attachedTo(store, tripId, file, names) }
}

export async function listTripDocuments(store: DataStore, tripId: string, view: TripView) {
  const trip = await requireTrip(store, tripId)
  if (!view.documents) return { files: [] }
  const all = await store.listAllFiles(trip.id)

  const stayIds = view.stays
    ? new Set<string>()
    : new Set(await store.listActivityIdsByCategory(trip.id, STAY_CATEGORY))
  const files = all.filter((f) => !f.activity_id || !stayIds.has(f.activity_id))

  // One shared cache across the list: several documents on the same activity
  // should cost one lookup, not one each.
  const names: NameCache = new Map()
  const documents: Awaited<ReturnType<typeof documentView>>[] = []
  for (const file of files) documents.push(await documentView(store, trip.id, file, names))
  return { files: documents }
}

export async function getFileUrl(store: DataStore, tripId: string, fileId: string) {
  const file = await store.getFile(tripId, fileId)
  if (!file) throw notFound('File')
  const result = await store.getFileUrl(file)
  if (result === 'FILE_MISSING') throw fileMissing()
  return result
}

/** Raw bytes + metadata for the in-app preview screen (GET /api/files/:id/content). */
export async function getFileContent(store: DataStore, tripId: string, fileId: string) {
  const file = await store.getFile(tripId, fileId)
  if (!file) throw notFound('File')
  const result = await store.getFileBytes(file)
  if (result === 'FILE_MISSING') throw fileMissing()
  return { file, ...result }
}

interface UploadBody {
  parent?: { kind?: 'trip' | 'zone' | 'activity'; id?: string }
  display_name?: string
  mime_type?: string
  data_base64?: string
}

/**
 * One rule for what a file may be called, shared by the upload and the rename
 * — 120 is the column's own check constraint (migration 0001), so a name that
 * passes here is a name the database will take.
 */
function collectNameErrors(value: unknown, errors: string[]): string {
  const display_name = (typeof value === 'string' ? value : '').trim()
  if (!display_name) errors.push('display_name is required')
  else if (display_name.length > 120) errors.push('display_name must be at most 120 characters')
  return display_name
}

export async function createFile(store: DataStore, tripId: string, body: UploadBody) {
  const errors: string[] = []
  const display_name = collectNameErrors(body.display_name, errors)

  const mime = (body.mime_type ?? '').toLowerCase()
  if (!EXT_BY_MIME[mime]) errors.push('file must be a PDF or an image (jpg, png, webp, gif, heic)')

  const raw = body.data_base64 ?? ''
  const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw // tolerate a data: URL prefix
  if (!b64) errors.push('data_base64 is required')

  const kind = body.parent?.kind
  if (kind !== 'trip' && kind !== 'zone' && kind !== 'activity')
    errors.push('parent.kind must be trip, zone, or place')
  if ((kind === 'zone' || kind === 'activity') && !body.parent?.id)
    errors.push(`parent.id is required for a ${kind}`)

  if (errors.length) throw validation(errors)

  const bytes = Buffer.from(b64, 'base64')
  if (bytes.length === 0) throw validation(['file is empty or not valid base64'])
  if (bytes.length > MAX_BYTES)
    throw validation([`file is too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)`])

  const trip = await requireTrip(store, tripId)

  const input = {
    display_name,
    mime_type: mime,
    storage_path: `uploads/${randomUUID()}.${EXT_BY_MIME[mime]}`,
    size_bytes: bytes.length,
    trip_id: kind === 'trip' ? trip.id : null,
    zone_id: kind === 'zone' ? body.parent!.id! : null,
    activity_id: kind === 'activity' ? body.parent!.id! : null,
  }

  if (kind === 'zone' && !(await store.getZone(trip.id, input.zone_id!))) throw notFound('Zone')
  if (kind === 'activity' && !(await store.getActivity(trip.id, input.activity_id!)))
    throw notFound('Activity')

  const file = await store.createFile(input, bytes)
  return { file: await documentView(store, trip.id, file) }
}

/**
 * Rename a file — the display name only.
 *
 * The blob is untouched: it is keyed by `storage_path`, a uuid, and the
 * extension a download gets is derived from the mime type rather than from
 * the name (see `downloadName`), so no rename can leave a file unopenable.
 */
export async function renameFile(
  store: DataStore,
  tripId: string,
  fileId: string,
  body: { display_name?: unknown }
) {
  const errors: string[] = []
  const display_name = collectNameErrors(body.display_name, errors)
  if (errors.length) throw validation(errors)

  const file = await store.updateFile(tripId, fileId, { display_name })
  if (!file) throw notFound('File')
  return { file: await documentView(store, tripId, file) }
}

export async function deleteFile(store: DataStore, tripId: string, fileId: string) {
  const ok = await store.deleteFile(tripId, fileId)
  if (!ok) throw notFound('File')
}
