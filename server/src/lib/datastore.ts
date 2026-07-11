// Datastore interface — every service depends on this, never on a concrete
// backend. DATA_BACKEND=memory (placeholder JSON, default) | supabase (Phase 8).

export const CATEGORIES = ['hotel', 'attraction', 'food', 'shopping', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

export interface Trip {
  id: string
  name: string
  start_date: string
  end_date: string
  description: string | null
}

export interface JourneyStep {
  id: string
  trip_id: string
  zone_id: string
  position: number
  start_date: string
  end_date: string
}

export interface Zone {
  id: string
  name: string
  name_ja: string | null
  summary: string | null
  image_url?: string | null
}

export interface PlaceLink {
  label: string
  url: string
}

export interface Place {
  id: string
  zone_id: string
  category: Category
  name: string
  name_ja: string | null
  description: string | null
  address: string | null
  links: PlaceLink[]
  image_url?: string | null
}

export interface Tip {
  id: string
  zone_id: string | null
  place_id: string | null
  body: string
}

export interface FileAttachment {
  id: string
  trip_id: string | null
  zone_id: string | null
  place_id: string | null
  display_name: string
  storage_path: string
  mime_type: string
  size_bytes: number
}

export interface PlaceInput {
  zone_id: string
  category: Category
  name: string
  name_ja?: string | null
  description?: string | null
  address?: string | null
  links?: PlaceLink[]
  image_url?: string | null
}

export interface TipInput {
  body: string
  zone_id?: string | null
  place_id?: string | null
}

export type FileUrlResult = { url: string; expires_in: number } | 'FILE_MISSING'

export interface DataStore {
  /** Trivial read used by /api/health (keep-alive). Throws if the backend is unreachable. */
  ping(): Promise<void>

  getTrip(): Promise<Trip | null>
  listSteps(tripId: string): Promise<JourneyStep[]>

  getZone(zoneId: string): Promise<Zone | null>
  countPlacesByCategory(zoneId: string): Promise<Record<Category, number>>

  listPlaces(zoneId: string, category: Category): Promise<Place[]>
  getPlace(placeId: string): Promise<Place | null>
  createPlace(input: PlaceInput): Promise<Place>
  updatePlace(placeId: string, patch: Partial<PlaceInput>): Promise<Place | null>
  /** Hard delete; the place's tips are deleted with it. Returns false if not found. */
  deletePlace(placeId: string): Promise<boolean>

  listTips(parent: { zone_id: string } | { place_id: string }): Promise<Tip[]>
  createTip(input: TipInput): Promise<Tip>
  updateTip(tipId: string, body: string): Promise<Tip | null>
  deleteTip(tipId: string): Promise<boolean>

  listFiles(
    parent: { trip_id: string } | { zone_id: string } | { place_id: string }
  ): Promise<FileAttachment[]>
  countTripFiles(tripId: string): Promise<number>
  getFile(fileId: string): Promise<FileAttachment | null>
  /** Move a place's files to the trip (used before place deletion — no silent file loss). */
  reparentFilesToTrip(placeId: string, tripId: string): Promise<void>
  /** Resolve an openable URL for the blob, or FILE_MISSING when the row exists but the blob is gone. */
  getFileUrl(file: FileAttachment): Promise<FileUrlResult>
}

let store: DataStore | null = null

/** Returns the process-wide datastore selected by DATA_BACKEND (default: memory). */
export async function getDataStore(): Promise<DataStore> {
  if (store) return store
  const backend = process.env.DATA_BACKEND ?? 'memory'
  if (backend === 'memory') {
    const { createMemoryStore } = await import('./datastore.memory')
    store = createMemoryStore()
  } else if (backend === 'supabase') {
    // Implemented in Phase 8 (infrastructure activation): datastore.supabase.ts
    throw new Error(
      'DATA_BACKEND=supabase is not configured yet — infrastructure activation is a later phase. Use DATA_BACKEND=memory.'
    )
  } else {
    throw new Error(`Unknown DATA_BACKEND "${backend}" (expected "memory" or "supabase")`)
  }
  return store
}

/** Test hook: replace the process-wide store (pass null to reset to env selection). */
export function setDataStore(next: DataStore | null): void {
  store = next
}
