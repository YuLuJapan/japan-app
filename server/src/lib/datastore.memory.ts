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
  FileInput,
  FileUrlResult,
  ItineraryItem,
  ItineraryItemInput,
  JourneyStep,
  JourneyStepInput,
  Place,
  PlaceInput,
  Tip,
  TipInput,
  Trip,
  Zone,
  ZoneInput,
} from './datastore.js'
import { CATEGORIES } from './datastore.js'

export interface MemoryData {
  trip: Trip
  steps: JourneyStep[]
  zones: Zone[]
  places: Place[]
  tips: Tip[]
  files: FileAttachment[]
  itinerary?: ItineraryItem[]
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

export function createMemoryStore(initial?: MemoryData): DataStore {
  // deep clone so mutations never touch the caller's fixture or the JSON module cache
  const db: MemoryData = structuredClone(initial ?? loadPlaceholderData())
  db.itinerary ??= [] // optional in older fixtures
  // backfill fields added after some fixtures/seed rows were written
  for (const i of db.itinerary) {
    i.highlight ??= false
    i.icon ??= null
  }
  // uploaded blobs live in memory only (dev/tests); seeded samples come from public/
  const blobs = new Map<string, { bytes: Buffer; mime: string }>()
  let latestRates: ExchangeRates | null = null

  const emptyCounts = (): Record<Category, number> =>
    Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>

  return {
    async ping() {
      if (!db.trip) throw new Error('memory store is empty')
    },

    async getTrip() {
      return db.trip ?? null
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

    async listAllFiles() {
      return db.files.map((f) => structuredClone(f))
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

    async getLatestRates() {
      return latestRates ? { ...latestRates } : null
    },

    async saveRates(rates: ExchangeRates) {
      latestRates = { ...rates }
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
