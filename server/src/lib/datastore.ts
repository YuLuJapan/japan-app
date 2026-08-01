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

export interface JourneyStepInput {
  trip_id: string
  zone_id: string
  position?: number
  start_date: string
  end_date: string
}

export interface Zone {
  id: string
  name: string
  name_ja: string | null
  summary: string | null
  image_url?: string | null
  lat?: number | null
  lng?: number | null
}

export interface ZoneInput {
  name: string
  name_ja?: string | null
  summary?: string | null
  image_url?: string | null
  lat?: number | null
  lng?: number | null
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
  lat?: number | null
  lng?: number | null
}

export interface Tip {
  id: string
  zone_id: string | null
  place_id: string | null
  body: string
}

export interface ItineraryItem {
  id: string
  trip_id: string
  zone_id: string | null
  place_id: string | null
  day: string // YYYY-MM-DD
  start_time: string | null // HH:MM (24h) or null
  title: string
  note: string | null
  position: number
  highlight: boolean // shown as a "featured" banner above the day's plan
  icon: string | null // leading emoji for the banner
}

export interface ItineraryItemInput {
  trip_id: string
  zone_id?: string | null
  place_id?: string | null
  day: string
  start_time?: string | null
  title: string
  note?: string | null
  position?: number
  highlight?: boolean
  icon?: string | null
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
  lat?: number | null
  lng?: number | null
}

export interface TipInput {
  body: string
  zone_id?: string | null
  place_id?: string | null
}

export interface FileInput {
  trip_id?: string | null
  zone_id?: string | null
  place_id?: string | null
  display_name: string
  storage_path: string
  mime_type: string
  size_bytes: number
}

export interface ExchangeRates {
  base: 'JPY'
  date: string // YYYY-MM-DD
  usd: number // 1 JPY in USD
  ils: number // 1 JPY in ILS
}

/** A scheduled nudge ("book the ryokan") delivered as a web push notification. */
export interface Reminder {
  id: string
  trip_id: string
  title: string
  body: string | null
  url: string | null
  remind_at: string // absolute instant (ISO 8601, UTC) — timezone-proof
  time_zone: string // IANA zone the wall-clock time was entered in (display only)
  sent_at: string | null // set when the dispatcher claimed it; null = still pending
  created_at: string
}

export interface ReminderInput {
  trip_id: string
  title: string
  body?: string | null
  url?: string | null
  remind_at: string
  time_zone?: string | null
}

/** One browser's push endpoint (one row per installed app / device). */
export interface PushSubscriptionRecord {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  label: string | null
  created_at: string
}

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  label?: string | null
}

export type FileUrlResult = { url: string; expires_in: number } | 'FILE_MISSING'

export interface DataStore {
  /** Trivial read used by /api/health (keep-alive). Throws if the backend is unreachable. */
  ping(): Promise<void>

  getTrip(): Promise<Trip | null>
  listSteps(tripId: string): Promise<JourneyStep[]>
  getStep(stepId: string): Promise<JourneyStep | null>
  createStep(input: JourneyStepInput): Promise<JourneyStep>
  updateStep(stepId: string, patch: Partial<JourneyStepInput>): Promise<JourneyStep | null>
  /** Hard delete. Callers are responsible for compacting positions afterward. */
  deleteStep(stepId: string): Promise<boolean>

  /** Every zone in the trip's catalog (used to find-or-create a zone for a free-text destination). */
  listZones(): Promise<Zone[]>
  getZone(zoneId: string): Promise<Zone | null>
  /** Create a zone on the fly for a destination that doesn't match an existing one. */
  createZone(input: ZoneInput): Promise<Zone>
  countPlacesByCategory(zoneId: string): Promise<Record<Category, number>>

  listPlaces(zoneId: string, category: Category): Promise<Place[]>
  /** Every place in a zone, all categories (used by the city map). */
  listPlacesInZone(zoneId: string): Promise<Place[]>
  getPlace(placeId: string): Promise<Place | null>
  createPlace(input: PlaceInput): Promise<Place>
  updatePlace(placeId: string, patch: Partial<PlaceInput>): Promise<Place | null>
  /** Hard delete; the place's tips are deleted with it. Returns false if not found. */
  deletePlace(placeId: string): Promise<boolean>

  listItinerary(tripId: string): Promise<ItineraryItem[]>
  createItineraryItem(input: ItineraryItemInput): Promise<ItineraryItem>
  updateItineraryItem(
    itemId: string,
    patch: Partial<ItineraryItemInput>
  ): Promise<ItineraryItem | null>
  deleteItineraryItem(itemId: string): Promise<boolean>

  listTips(parent: { zone_id: string } | { place_id: string }): Promise<Tip[]>
  createTip(input: TipInput): Promise<Tip>
  updateTip(tipId: string, body: string): Promise<Tip | null>
  deleteTip(tipId: string): Promise<boolean>

  listFiles(
    parent: { trip_id: string } | { zone_id: string } | { place_id: string }
  ): Promise<FileAttachment[]>
  /** Every file for the trip regardless of parent (used by the Documents view). */
  listAllFiles(): Promise<FileAttachment[]>
  countTripFiles(tripId: string): Promise<number>
  getFile(fileId: string): Promise<FileAttachment | null>
  /** Store an uploaded blob and its metadata row. */
  createFile(input: FileInput, bytes: Buffer): Promise<FileAttachment>
  /** Delete the metadata row and its blob. Returns false if the row is missing. */
  deleteFile(fileId: string): Promise<boolean>
  /** Move a place's files to the trip (used before place deletion — no silent file loss). */
  reparentFilesToTrip(placeId: string, tripId: string): Promise<void>
  /** Resolve an openable URL for the blob, or FILE_MISSING when the row exists but the blob is gone. */
  getFileUrl(file: FileAttachment): Promise<FileUrlResult>

  /** Free-text search across places, zones, and tips (case-insensitive). */
  search(query: string): Promise<{ places: Place[]; zones: Zone[]; tips: Tip[] }>

  /** Last exchange rate we successfully fetched (durable fallback), or null. */
  getLatestRates(): Promise<ExchangeRates | null>
  /** Persist the latest fetched exchange rate (one row per base currency). */
  saveRates(rates: ExchangeRates): Promise<void>

  /** Every reminder for the trip, soonest first. */
  listReminders(tripId: string): Promise<Reminder[]>
  getReminder(reminderId: string): Promise<Reminder | null>
  createReminder(input: ReminderInput): Promise<Reminder>
  updateReminder(
    reminderId: string,
    patch: Partial<ReminderInput> & { sent_at?: string | null }
  ): Promise<Reminder | null>
  deleteReminder(reminderId: string): Promise<boolean>
  /**
   * Atomically hand out every unsent reminder whose time has come, stamping
   * `sent_at` in the same operation. Claim-then-send means a reminder is sent
   * at most once even if two dispatch runs overlap (at-most-once, by design:
   * a duplicate notification is worse than a missed retry here).
   */
  claimDueReminders(nowIso: string): Promise<Reminder[]>

  listPushSubscriptions(): Promise<PushSubscriptionRecord[]>
  /** Upsert by endpoint — re-subscribing the same device refreshes its keys. */
  savePushSubscription(input: PushSubscriptionInput): Promise<PushSubscriptionRecord>
  /** Drop a device (user disabled notifications, or the push service said 410 Gone). */
  deletePushSubscription(endpoint: string): Promise<boolean>
}

let store: DataStore | null = null

/** Returns the process-wide datastore selected by DATA_BACKEND (default: memory). */
export async function getDataStore(): Promise<DataStore> {
  if (store) return store
  const backend = process.env.DATA_BACKEND ?? 'memory'
  if (backend === 'memory') {
    const { createMemoryStore } = await import('./datastore.memory.js')
    store = createMemoryStore()
  } else if (backend === 'supabase') {
    const { createSupabaseStore } = await import('./datastore.supabase.js')
    store = createSupabaseStore()
  } else {
    throw new Error(`Unknown DATA_BACKEND "${backend}" (expected "memory" or "supabase")`)
  }
  return store
}

/** Test hook: replace the process-wide store (pass null to reset to env selection). */
export function setDataStore(next: DataStore | null): void {
  store = next
}
