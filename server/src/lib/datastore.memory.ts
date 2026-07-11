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
  FileAttachment,
  FileUrlResult,
  JourneyStep,
  Place,
  PlaceInput,
  Tip,
  TipInput,
  Trip,
  Zone,
} from './datastore'
import { CATEGORIES } from './datastore'

export interface MemoryData {
  trip: Trip
  steps: JourneyStep[]
  zones: Zone[]
  places: Place[]
  tips: Tip[]
  files: FileAttachment[]
}

function loadPlaceholderData(): MemoryData {
  const dataPath = fileURLToPath(new URL('../data/placeholder-data.json', import.meta.url))
  return JSON.parse(readFileSync(dataPath, 'utf-8')) as MemoryData
}

export function createMemoryStore(initial?: MemoryData): DataStore {
  // deep clone so mutations never touch the caller's fixture or the JSON module cache
  const db: MemoryData = structuredClone(initial ?? loadPlaceholderData())

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
      return db.steps
        .filter((s) => s.trip_id === tripId)
        .sort((a, b) => a.position - b.position)
    },

    async getZone(zoneId) {
      return db.zones.find((z) => z.id === zoneId) ?? null
    },

    async countPlacesByCategory(zoneId) {
      const counts = emptyCounts()
      for (const p of db.places) if (p.zone_id === zoneId) counts[p.category]++
      return counts
    },

    async listPlaces(zoneId, category) {
      return db.places.filter((p) => p.zone_id === zoneId && p.category === category)
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
      return structuredClone(place)
    },

    async deletePlace(placeId) {
      const idx = db.places.findIndex((p) => p.id === placeId)
      if (idx === -1) return false
      db.places.splice(idx, 1)
      db.tips = db.tips.filter((t) => t.place_id !== placeId) // cascade
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

    async countTripFiles(tripId) {
      return db.files.filter((f) => f.trip_id === tripId).length
    },

    async getFile(fileId) {
      return db.files.find((f) => f.id === fileId) ?? null
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
      // memory mode serves samples statically from public/; missing file on
      // disk = the FILE_MISSING edge case from the contract
      const abs = path.join(process.cwd(), 'public', file.storage_path)
      if (!existsSync(abs)) return 'FILE_MISSING'
      return { url: `/${file.storage_path.replace(/\\/g, '/')}`, expires_in: 300 }
    },
  }
}
