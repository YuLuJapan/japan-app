// Placeholder in-memory datastore (DATA_BACKEND=memory, the default).
// Loads server/src/data/placeholder-data.json at startup and applies mutations
// in memory only — state resets on restart. Durable persistence arrives with
// the Supabase implementation in the infrastructure-activation phase.
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  Category,
  DataStore,
  ExchangeRates,
  FileAttachment,
  FileBytesResult,
  FileInput,
  FileUrlResult,
  ItineraryItem,
  ItineraryItemInput,
  JourneyStep,
  JourneyStepInput,
  Place,
  PlaceInput,
  PushSubscriptionInput,
  PushSubscriptionRecord,
  Reminder,
  ReminderInput,
  ShoppingItem,
  ShoppingItemInput,
  Tip,
  TipInput,
  Trip,
  TripInput,
  Zone,
  ZoneInput,
} from './datastore.js'
import { CATEGORIES } from './datastore.js'

export interface MemoryData {
  trips: Trip[]
  steps: JourneyStep[]
  zones: Zone[]
  places: Place[]
  tips: Tip[]
  files: FileAttachment[]
  itinerary?: ItineraryItem[]
  shopping?: ShoppingItem[]
  reminders?: Reminder[]
}

function loadPlaceholderData(): MemoryData {
  const dataPath = fileURLToPath(new URL('../data/placeholder-data.json', import.meta.url))
  return JSON.parse(readFileSync(dataPath, 'utf-8')) as MemoryData
}

// Journey order follows arrival date, not manual position — a step added
// with an earlier start_date sorts ahead of ones already in the list.
function compareSteps(a: JourneyStep, b: JourneyStep): number {
  if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}

// Stable itinerary order: by day, then timed items (ascending) before untimed,
// then manual position, then id.
function compareItinerary(a: ItineraryItem, b: ItineraryItem): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  if (a.start_time !== b.start_time) {
    if (a.start_time === null) return 1
    if (b.start_time === null) return -1
    return a.start_time < b.start_time ? -1 : 1
  }
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}

// Shopping list order: unbought items first (that's the working list), then
// manual position, then id — bought items sink to the bottom.
function compareShopping(a: ShoppingItem, b: ShoppingItem): number {
  if (a.bought !== b.bought) return a.bought ? 1 : -1
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}

export function createMemoryStore(initial?: MemoryData): DataStore {
  // deep clone so mutations never touch the caller's fixture or the JSON module cache
  const db: MemoryData = structuredClone(initial ?? loadPlaceholderData())
  db.itinerary ??= [] // optional in older fixtures
  db.shopping ??= []
  db.reminders ??= []
  // backfill fields added after some fixtures/seed rows were written
  for (const i of db.itinerary) {
    i.highlight ??= false
    i.icon ??= null
  }
  // uploaded blobs live in memory only (dev/tests); seeded samples come from public/
  const blobs = new Map<string, { bytes: Buffer; mime: string }>()
  let latestRates: ExchangeRates | null = null
  const subscriptions: PushSubscriptionRecord[] = []

  const emptyCounts = (): Record<Category, number> =>
    Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>

  return {
    async ping() {
      if (!db.trips.length) throw new Error('memory store is empty')
    },

    async listTrips() {
      return db.trips.map((t) => structuredClone(t))
    },

    async getTrip(tripId) {
      const trip = db.trips.find((t) => t.id === tripId)
      return trip ? structuredClone(trip) : null
    },

    async createTrip(input: TripInput) {
      const trip: Trip = {
        id: randomUUID(),
        name: input.name,
        start_date: input.start_date,
        end_date: input.end_date,
        description: input.description ?? null,
        people: input.people ?? [],
      }
      db.trips.push(trip)
      return structuredClone(trip)
    },

    async updateTrip(tripId, patch) {
      const trip = db.trips.find((t) => t.id === tripId)
      if (!trip) return null
      if (patch.name !== undefined) trip.name = patch.name
      if (patch.start_date !== undefined) trip.start_date = patch.start_date
      if (patch.end_date !== undefined) trip.end_date = patch.end_date
      if (patch.description !== undefined) trip.description = patch.description ?? null
      if (patch.people !== undefined) trip.people = patch.people ?? []
      return structuredClone(trip)
    },

    async deleteTrip(tripId) {
      const idx = db.trips.findIndex((t) => t.id === tripId)
      if (idx === -1) return false
      db.trips.splice(idx, 1)
      // mirror the DB's `on delete cascade` on trip_id (real Postgres does this for free)
      db.steps = db.steps.filter((s) => s.trip_id !== tripId)
      db.itinerary = (db.itinerary ?? []).filter((i) => i.trip_id !== tripId)
      db.shopping = (db.shopping ?? []).filter((s) => s.trip_id !== tripId)
      db.reminders = (db.reminders ?? []).filter((r) => r.trip_id !== tripId)
      db.files = db.files.filter((f) => f.trip_id !== tripId)
      return true
    },

    async listSteps(tripId) {
      return db.steps.filter((s) => s.trip_id === tripId).sort(compareSteps)
    },

    async getStep(stepId) {
      return db.steps.find((s) => s.id === stepId) ?? null
    },

    async createStep(input: JourneyStepInput) {
      const step: JourneyStep = {
        id: randomUUID(),
        trip_id: input.trip_id,
        zone_id: input.zone_id,
        position: input.position ?? 0,
        start_date: input.start_date,
        end_date: input.end_date,
      }
      db.steps.push(step)
      return structuredClone(step)
    },

    async updateStep(stepId, patch) {
      const step = db.steps.find((s) => s.id === stepId)
      if (!step) return null
      if (patch.zone_id !== undefined) step.zone_id = patch.zone_id
      if (patch.position !== undefined) step.position = patch.position
      if (patch.start_date !== undefined) step.start_date = patch.start_date
      if (patch.end_date !== undefined) step.end_date = patch.end_date
      return structuredClone(step)
    },

    async deleteStep(stepId) {
      const idx = db.steps.findIndex((s) => s.id === stepId)
      if (idx === -1) return false
      db.steps.splice(idx, 1)
      return true
    },

    async listZones() {
      return db.zones.map((z) => structuredClone(z))
    },

    async getZone(zoneId) {
      return db.zones.find((z) => z.id === zoneId) ?? null
    },

    async createZone(input: ZoneInput) {
      const zone: Zone = {
        id: randomUUID(),
        name: input.name,
        name_ja: input.name_ja ?? null,
        summary: input.summary ?? null,
        image_url: input.image_url ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
      }
      db.zones.push(zone)
      return structuredClone(zone)
    },

    async countPlacesByCategory(zoneId) {
      const counts = emptyCounts()
      for (const p of db.places) if (p.zone_id === zoneId) counts[p.category]++
      return counts
    },

    async listPlaces(zoneId, category) {
      return db.places.filter((p) => p.zone_id === zoneId && p.category === category)
    },

    async listPlacesInZone(zoneId) {
      return db.places.filter((p) => p.zone_id === zoneId)
    },

    async getPlace(placeId) {
      return db.places.find((p) => p.id === placeId) ?? null
    },

    async createPlace(input: PlaceInput) {
      const place: Place = {
        id: randomUUID(),
        zone_id: input.zone_id,
        category: input.category,
        name: input.name,
        name_ja: input.name_ja ?? null,
        description: input.description ?? null,
        address: input.address ?? null,
        links: input.links ?? [],
        image_url: input.image_url ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
      }
      db.places.push(place)
      return structuredClone(place)
    },

    async updatePlace(placeId, patch) {
      const place = db.places.find((p) => p.id === placeId)
      if (!place) return null
      // last write wins (spec edge case: concurrent edits)
      if (patch.zone_id !== undefined) place.zone_id = patch.zone_id
      if (patch.category !== undefined) place.category = patch.category
      if (patch.name !== undefined) place.name = patch.name
      if (patch.name_ja !== undefined) place.name_ja = patch.name_ja ?? null
      if (patch.description !== undefined) place.description = patch.description ?? null
      if (patch.address !== undefined) place.address = patch.address ?? null
      if (patch.links !== undefined) place.links = patch.links ?? []
      if (patch.image_url !== undefined) place.image_url = patch.image_url ?? null
      if (patch.lat !== undefined) place.lat = patch.lat ?? null
      if (patch.lng !== undefined) place.lng = patch.lng ?? null
      return structuredClone(place)
    },

    async deletePlace(placeId) {
      const idx = db.places.findIndex((p) => p.id === placeId)
      if (idx === -1) return false
      db.places.splice(idx, 1)
      db.tips = db.tips.filter((t) => t.place_id !== placeId) // cascade
      // keep the day plan; just unlink the deleted place (mirrors on delete set null)
      for (const item of db.itinerary!) if (item.place_id === placeId) item.place_id = null
      return true
    },

    async listItinerary(tripId) {
      return db.itinerary!.filter((i) => i.trip_id === tripId).sort(compareItinerary)
    },

    async createItineraryItem(input: ItineraryItemInput) {
      const item: ItineraryItem = {
        id: randomUUID(),
        trip_id: input.trip_id,
        zone_id: input.zone_id ?? null,
        place_id: input.place_id ?? null,
        day: input.day,
        start_time: input.start_time ?? null,
        title: input.title,
        note: input.note ?? null,
        position: input.position ?? 0,
        highlight: input.highlight ?? false,
        icon: input.icon ?? null,
      }
      db.itinerary!.push(item)
      return structuredClone(item)
    },

    async updateItineraryItem(itemId, patch) {
      const item = db.itinerary!.find((i) => i.id === itemId)
      if (!item) return null
      if (patch.zone_id !== undefined) item.zone_id = patch.zone_id ?? null
      if (patch.place_id !== undefined) item.place_id = patch.place_id ?? null
      if (patch.day !== undefined) item.day = patch.day
      if (patch.start_time !== undefined) item.start_time = patch.start_time ?? null
      if (patch.title !== undefined) item.title = patch.title
      if (patch.note !== undefined) item.note = patch.note ?? null
      if (patch.position !== undefined) item.position = patch.position ?? 0
      if (patch.highlight !== undefined) item.highlight = patch.highlight ?? false
      if (patch.icon !== undefined) item.icon = patch.icon ?? null
      return structuredClone(item)
    },

    async deleteItineraryItem(itemId) {
      const i = db.itinerary!.findIndex((x) => x.id === itemId)
      if (i === -1) return false
      db.itinerary!.splice(i, 1)
      return true
    },

    async listShoppingItems(tripId) {
      return db.shopping!.filter((s) => s.trip_id === tripId).sort(compareShopping)
    },

    async createShoppingItem(input: ShoppingItemInput) {
      const item: ShoppingItem = {
        id: randomUUID(),
        trip_id: input.trip_id,
        name: input.name,
        category: input.category ?? 'other',
        note: input.note ?? null,
        shop: input.shop ?? null,
        zone_id: input.zone_id ?? null,
        price_yen: input.price_yen ?? null,
        url: input.url ?? null,
        image_url: input.image_url ?? null,
        bought: input.bought ?? false,
        position: input.position ?? 0,
      }
      db.shopping!.push(item)
      return structuredClone(item)
    },

    async updateShoppingItem(itemId, patch) {
      const item = db.shopping!.find((s) => s.id === itemId)
      if (!item) return null
      if (patch.name !== undefined) item.name = patch.name
      if (patch.category !== undefined) item.category = patch.category ?? 'other'
      if (patch.note !== undefined) item.note = patch.note ?? null
      if (patch.shop !== undefined) item.shop = patch.shop ?? null
      if (patch.zone_id !== undefined) item.zone_id = patch.zone_id ?? null
      if (patch.price_yen !== undefined) item.price_yen = patch.price_yen ?? null
      if (patch.url !== undefined) item.url = patch.url ?? null
      if (patch.image_url !== undefined) item.image_url = patch.image_url ?? null
      if (patch.bought !== undefined) item.bought = patch.bought ?? false
      if (patch.position !== undefined) item.position = patch.position ?? 0
      return structuredClone(item)
    },

    async deleteShoppingItem(itemId) {
      const i = db.shopping!.findIndex((s) => s.id === itemId)
      if (i === -1) return false
      db.shopping!.splice(i, 1)
      return true
    },

    async listTips(parent) {
      if ('zone_id' in parent) return db.tips.filter((t) => t.zone_id === parent.zone_id)
      return db.tips.filter((t) => t.place_id === parent.place_id)
    },

    async createTip(input: TipInput) {
      const tip: Tip = {
        id: randomUUID(),
        zone_id: input.zone_id ?? null,
        place_id: input.place_id ?? null,
        body: input.body,
      }
      db.tips.push(tip)
      return structuredClone(tip)
    },

    async updateTip(tipId, body) {
      const tip = db.tips.find((t) => t.id === tipId)
      if (!tip) return null
      tip.body = body
      return structuredClone(tip)
    },

    async deleteTip(tipId) {
      const idx = db.tips.findIndex((t) => t.id === tipId)
      if (idx === -1) return false
      db.tips.splice(idx, 1)
      return true
    },

    async listFiles(parent) {
      if ('trip_id' in parent) return db.files.filter((f) => f.trip_id === parent.trip_id)
      if ('zone_id' in parent) return db.files.filter((f) => f.zone_id === parent.zone_id)
      return db.files.filter((f) => f.place_id === parent.place_id)
    },

    async listAllFiles(tripId) {
      const zoneIds = new Set(db.steps.filter((s) => s.trip_id === tripId).map((s) => s.zone_id))
      const placeIds = new Set(db.places.filter((p) => zoneIds.has(p.zone_id)).map((p) => p.id))
      return db.files
        .filter(
          (f) =>
            f.trip_id === tripId ||
            (f.zone_id && zoneIds.has(f.zone_id)) ||
            (f.place_id && placeIds.has(f.place_id))
        )
        .map((f) => structuredClone(f))
    },

    async countTripFiles(tripId) {
      return db.files.filter((f) => f.trip_id === tripId).length
    },

    async getFile(fileId) {
      return db.files.find((f) => f.id === fileId) ?? null
    },

    async createFile(input: FileInput, bytes: Buffer) {
      const file: FileAttachment = {
        id: randomUUID(),
        trip_id: input.trip_id ?? null,
        zone_id: input.zone_id ?? null,
        place_id: input.place_id ?? null,
        display_name: input.display_name,
        storage_path: input.storage_path,
        mime_type: input.mime_type,
        size_bytes: input.size_bytes,
      }
      db.files.push(file)
      blobs.set(file.id, { bytes, mime: file.mime_type })
      return structuredClone(file)
    },

    async deleteFile(fileId) {
      const idx = db.files.findIndex((f) => f.id === fileId)
      if (idx === -1) return false
      db.files.splice(idx, 1)
      blobs.delete(fileId)
      return true
    },

    async reparentFilesToTrip(placeId, tripId) {
      for (const f of db.files) {
        if (f.place_id === placeId) {
          f.place_id = null
          f.trip_id = tripId
        }
      }
    },

    async getFileUrl(file): Promise<FileUrlResult> {
      // uploaded blobs are held in memory → serve as a data URL (dev/tests)
      const blob = blobs.get(file.id)
      if (blob) {
        return { url: `data:${blob.mime};base64,${blob.bytes.toString('base64')}`, expires_in: 300 }
      }
      // seeded samples are served statically from public/; missing file on
      // disk = the FILE_MISSING edge case from the contract
      const abs = path.join(process.cwd(), 'public', file.storage_path)
      if (!existsSync(abs)) return 'FILE_MISSING'
      return { url: `/${file.storage_path.replace(/\\/g, '/')}`, expires_in: 300 }
    },

    async getFileBytes(file): Promise<FileBytesResult> {
      const blob = blobs.get(file.id)
      if (blob) return { bytes: blob.bytes, mime_type: blob.mime }
      const abs = path.join(process.cwd(), 'public', file.storage_path)
      if (!existsSync(abs)) return 'FILE_MISSING'
      return { bytes: readFileSync(abs), mime_type: file.mime_type }
    },

    async getLatestRates() {
      return latestRates ? { ...latestRates } : null
    },

    async saveRates(rates: ExchangeRates) {
      latestRates = { ...rates }
    },

    async listReminders(tripId) {
      return db
        .reminders!.filter((r) => r.trip_id === tripId)
        .sort((a, b) => (a.remind_at < b.remind_at ? -1 : a.remind_at > b.remind_at ? 1 : 0))
        .map((r) => structuredClone(r))
    },

    async getReminder(reminderId) {
      const found = db.reminders!.find((r) => r.id === reminderId)
      return found ? structuredClone(found) : null
    },

    async createReminder(input: ReminderInput) {
      const reminder: Reminder = {
        id: randomUUID(),
        trip_id: input.trip_id,
        title: input.title,
        body: input.body ?? null,
        url: input.url ?? null,
        remind_at: input.remind_at,
        time_zone: input.time_zone ?? 'UTC',
        sent_at: null,
        created_at: new Date().toISOString(),
      }
      db.reminders!.push(reminder)
      return structuredClone(reminder)
    },

    async updateReminder(reminderId, patch) {
      const reminder = db.reminders!.find((r) => r.id === reminderId)
      if (!reminder) return null
      if (patch.title !== undefined) reminder.title = patch.title
      if (patch.body !== undefined) reminder.body = patch.body ?? null
      if (patch.url !== undefined) reminder.url = patch.url ?? null
      if (patch.remind_at !== undefined) reminder.remind_at = patch.remind_at
      if (patch.time_zone !== undefined) reminder.time_zone = patch.time_zone ?? 'UTC'
      if (patch.sent_at !== undefined) reminder.sent_at = patch.sent_at
      return structuredClone(reminder)
    },

    async deleteReminder(reminderId) {
      const idx = db.reminders!.findIndex((r) => r.id === reminderId)
      if (idx === -1) return false
      db.reminders!.splice(idx, 1)
      return true
    },

    async claimDueReminders(nowIso) {
      const due = db.reminders!.filter((r) => r.sent_at === null && r.remind_at <= nowIso)
      for (const r of due) r.sent_at = nowIso
      return due.map((r) => structuredClone(r))
    },

    async listPushSubscriptions() {
      return subscriptions.map((s) => ({ ...s }))
    },

    async savePushSubscription(input: PushSubscriptionInput) {
      const existing = subscriptions.find((s) => s.endpoint === input.endpoint)
      if (existing) {
        existing.p256dh = input.p256dh
        existing.auth = input.auth
        if (input.label !== undefined) existing.label = input.label ?? null
        return { ...existing }
      }
      const record: PushSubscriptionRecord = {
        id: randomUUID(),
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        label: input.label ?? null,
        created_at: new Date().toISOString(),
      }
      subscriptions.push(record)
      return { ...record }
    },

    async deletePushSubscription(endpoint) {
      const idx = subscriptions.findIndex((s) => s.endpoint === endpoint)
      if (idx === -1) return false
      subscriptions.splice(idx, 1)
      return true
    },

    async search(query) {
      const q = query.trim().toLowerCase()
      const has = (s?: string | null) => !!s && s.toLowerCase().includes(q)
      return {
        places: db.places.filter(
          (p) => has(p.name) || has(p.name_ja) || has(p.description) || has(p.address)
        ),
        zones: db.zones.filter((z) => has(z.name) || has(z.name_ja) || has(z.summary)),
        tips: db.tips.filter((t) => has(t.body)),
      }
    },
  }
}
