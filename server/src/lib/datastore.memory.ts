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
  Profile,
  StoredTripInvite,
  TripMember,
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
import { normalizeFlight } from './flight.js'
import { DEFAULT_HOME_CURRENCIES, DEFAULT_LOCAL_CURRENCY, normalizeCurrency } from './currencies.js'

/** Keeps only codes we can quote; falls back to the pair the app always had. */
function cleanHomeCurrencies(value: unknown): string[] {
  const codes = Array.isArray(value)
    ? [...new Set(value.map(normalizeCurrency).filter((c): c is string => !!c))]
    : []
  return codes.length ? codes : [...DEFAULT_HOME_CURRENCIES]
}

export interface MemoryData {
  profiles?: Profile[]
  members?: TripMember[]
  invites?: StoredTripInvite[]
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
  // The flight is jsonb in Postgres and free-form JSON here, so it is checked
  // on the way in exactly as the Supabase store checks it (lib/flight.ts).
  for (const t of db.trips) {
    t.flight = normalizeFlight(t.flight)
    // 0020, same story: a seed row from before the columns existed still loads.
    t.start_time = t.start_time ?? null
    t.start_tz = t.start_tz ?? null
    // Seeded/legacy rows predate the currency pickers — default them the same
    // way the Postgres columns do, so every trip has a calculator that works.
    t.local_currency = normalizeCurrency(t.local_currency) ?? DEFAULT_LOCAL_CURRENCY
    t.home_currencies = cleanHomeCurrencies(t.home_currencies)
  }
  // uploaded blobs live in memory only (dev/tests); seeded samples come from public/
  const blobs = new Map<string, { bytes: Buffer; mime: string }>()
  // One entry per base currency: a trip in euros and a trip in yen each keep
  // their own last-known rate to fall back on.
  const latestRates = new Map<string, ExchangeRates>()
  const subscriptions: PushSubscriptionRecord[] = []

  // Since migration 0013 a zone belongs to exactly one trip, so "is this row
  // in that trip?" is a zone lookup for anything hanging off a zone.
  const zoneIn = (tripId: string, zoneId: string) =>
    db.zones.some((z) => z.id === zoneId && z.trip_id === tripId)
  const placesIn = (tripId: string) => db.places.filter((p) => zoneIn(tripId, p.zone_id))
  const placeIn = (tripId: string, placeId: string) =>
    db.places.some((p) => p.id === placeId && zoneIn(tripId, p.zone_id))
  /** A tip hangs off exactly one parent, and inherits that parent's trip. */
  const tipIn = (tripId: string, tip: Tip) =>
    tip.zone_id ? zoneIn(tripId, tip.zone_id) : !!tip.place_id && placeIn(tripId, tip.place_id)
  /** A file hangs off the trip directly, or off one of its zones or places. */
  const fileIn = (tripId: string, f: FileAttachment) =>
    f.trip_id === tripId ||
    (!!f.zone_id && zoneIn(tripId, f.zone_id)) ||
    (!!f.place_id && placeIn(tripId, f.place_id))

  const emptyCounts = (): Record<Category, number> =>
    Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>

  const profiles: Profile[] = db.profiles ? db.profiles.map((p) => structuredClone(p)) : []
  const members: TripMember[] = db.members ? db.members.map((m) => structuredClone(m)) : []
  const invites: StoredTripInvite[] = db.invites ? db.invites.map((i) => structuredClone(i)) : []

  /**
   * Drops the hash on the way out. The `TripInvite` return type says the hash
   * is absent, but a structural type cannot strip a property at runtime — so
   * returning the stored row directly would hand the hash to every caller.
   */
  const toInvite = ({ token_hash: _hash, ...rest }: StoredTripInvite) => structuredClone(rest)

  const tripsForUser = (userId: string) => {
    const mine = new Set(members.filter((m) => m.user_id === userId).map((m) => m.trip_id))
    return db.trips.filter((t) => mine.has(t.id))
  }

  return {
    async ping() {
      if (!db.trips.length) throw new Error('memory store is empty')
    },

    async getProfile(userId) {
      const found = profiles.find((p) => p.id === userId)
      return found ? structuredClone(found) : null
    },

    async getProfileByEmail(email) {
      const needle = email.trim().toLowerCase()
      const found = profiles.find((p) => p.email.toLowerCase() === needle)
      return found ? structuredClone(found) : null
    },

    async upsertProfile(input) {
      const existing = profiles.find((p) => p.id === input.id)
      if (existing) {
        // Only overwrite with values the provider actually gave us — signing in
        // with a provider that omits a name must not blank out one we already have.
        existing.email = input.email
        if (input.display_name != null) existing.display_name = input.display_name
        if (input.avatar_url != null) existing.avatar_url = input.avatar_url
        // Acceptance is never touched here: signing in again is not agreeing again.
        return structuredClone(existing)
      }
      const created: Profile = {
        id: input.id,
        email: input.email,
        display_name: input.display_name ?? null,
        avatar_url: input.avatar_url ?? null,
      }
      profiles.push(created)
      return structuredClone(created)
    },

    async acceptTerms(userId, version, at) {
      const profile = profiles.find((p) => p.id === userId)
      if (!profile) return null
      profile.accepted_terms_at = at
      profile.accepted_terms_version = version
      return structuredClone(profile)
    },

    async listTripsForUser(userId) {
      return tripsForUser(userId).map((t) => structuredClone(t))
    },

    async listTripInvites(tripId) {
      return invites
        .filter((i) => i.trip_id === tripId && !i.accepted_at && !i.revoked_at)
        .map(toInvite)
    },

    async listInvitesForEmail(email) {
      const wanted = email.trim().toLowerCase()
      if (!wanted) return []
      return invites.filter((i) => i.email?.toLowerCase() === wanted).map(toInvite)
    },

    async getInviteById(inviteId) {
      const found = invites.find((i) => i.id === inviteId)
      return found ? toInvite(found) : null
    },

    async getInviteByTokenHash(tokenHash) {
      const found = invites.find((i) => i.token_hash === tokenHash)
      return found ? toInvite(found) : null
    },

    async getTripInvite(tripId, inviteId) {
      const found = invites.find((i) => i.id === inviteId && i.trip_id === tripId)
      return found ? toInvite(found) : null
    },

    async createTripInvite(input) {
      const invite: StoredTripInvite = {
        id: randomUUID(),
        trip_id: input.trip_id,
        email: input.email ?? null,
        role: input.role,
        can_see_stays: input.can_see_stays ?? true,
        can_see_flight: input.can_see_flight ?? true,
        can_see_documents: input.can_see_documents ?? false,
        can_see_shopping: input.can_see_shopping ?? true,
        token_hash: input.token_hash,
        invited_by: input.invited_by,
        expires_at: input.expires_at,
        accepted_at: null,
        accepted_by: null,
        revoked_at: null,
        declined_at: null,
        created_at: new Date().toISOString(),
      }
      invites.push(invite)
      return toInvite(invite)
    },

    async updateTripInvite(inviteId, patch) {
      const invite = invites.find((i) => i.id === inviteId)
      if (!invite) return null
      // Single use: only an invite that is still open can be stamped.
      if (invite.accepted_at || invite.revoked_at || invite.declined_at) return null
      Object.assign(invite, patch)
      return toInvite(invite)
    },

    async listMembershipsForUser(userId) {
      return members.filter((m) => m.user_id === userId).map((m) => structuredClone(m))
    },

    async listTripMembers(tripId) {
      return members.filter((m) => m.trip_id === tripId).map((m) => structuredClone(m))
    },

    async getTripMember(tripId, userId) {
      const found = members.find((m) => m.trip_id === tripId && m.user_id === userId)
      return found ? structuredClone(found) : null
    },

    async upsertTripMember(input) {
      const existing = members.find(
        (m) => m.trip_id === input.trip_id && m.user_id === input.user_id
      )
      const next: TripMember = {
        trip_id: input.trip_id,
        user_id: input.user_id,
        role: input.role,
        can_see_stays: input.can_see_stays ?? existing?.can_see_stays ?? true,
        can_see_flight: input.can_see_flight ?? existing?.can_see_flight ?? true,
        can_see_documents: input.can_see_documents ?? existing?.can_see_documents ?? false,
        can_see_shopping: input.can_see_shopping ?? existing?.can_see_shopping ?? true,
      }
      if (existing) Object.assign(existing, next)
      else members.push(next)
      return structuredClone(next)
    },

    async removeTripMember(tripId, userId) {
      const i = members.findIndex((m) => m.trip_id === tripId && m.user_id === userId)
      if (i === -1) return false
      members.splice(i, 1)
      return true
    },

    async getTrip(tripId) {
      const trip = db.trips.find((t) => t.id === tripId)
      return trip ? structuredClone(trip) : null
    },

    async createTrip(input: TripInput) {
      const trip: Trip = {
        id: randomUUID(),
        name: input.name ?? null,
        country: input.country ?? null,
        start_date: input.start_date,
        end_date: input.end_date,
        description: input.description ?? null,
        people: input.people ?? [],
        // Checked on the way in exactly as a stored row is checked on the way
        // out, so a trip cannot hold a flight it would never read back.
        flight: normalizeFlight(input.flight),
        start_time: input.start_time ?? null,
        start_tz: input.start_tz ?? null,
        local_currency: input.local_currency ?? DEFAULT_LOCAL_CURRENCY,
        home_currencies: input.home_currencies ?? [...DEFAULT_HOME_CURRENCIES],
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
      if (patch.country !== undefined) trip.country = patch.country ?? null
      if (patch.local_currency !== undefined) trip.local_currency = patch.local_currency
      if (patch.home_currencies !== undefined) trip.home_currencies = patch.home_currencies
      if (patch.flight !== undefined) trip.flight = normalizeFlight(patch.flight)
      if (patch.start_time !== undefined) trip.start_time = patch.start_time ?? null
      if (patch.start_tz !== undefined) trip.start_tz = patch.start_tz ?? null
      return structuredClone(trip)
    },

    async deleteTrip(tripId) {
      const idx = db.trips.findIndex((t) => t.id === tripId)
      if (idx === -1) return false
      db.trips.splice(idx, 1)
      // mirror the DB's `on delete cascade` on trip_id (real Postgres does this for free)
      for (let i = members.length - 1; i >= 0; i--) {
        if (members[i].trip_id === tripId) members.splice(i, 1)
      }
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

    async getStep(tripId, stepId) {
      return db.steps.find((s) => s.id === stepId && s.trip_id === tripId) ?? null
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

    async updateStep(tripId, stepId, patch) {
      const step = db.steps.find((s) => s.id === stepId && s.trip_id === tripId)
      if (!step) return null
      if (patch.zone_id !== undefined && !zoneIn(tripId, patch.zone_id)) return null
      if (patch.zone_id !== undefined) step.zone_id = patch.zone_id
      if (patch.position !== undefined) step.position = patch.position
      if (patch.start_date !== undefined) step.start_date = patch.start_date
      if (patch.end_date !== undefined) step.end_date = patch.end_date
      return structuredClone(step)
    },

    async deleteStep(tripId, stepId) {
      const idx = db.steps.findIndex((s) => s.id === stepId && s.trip_id === tripId)
      if (idx === -1) return false
      db.steps.splice(idx, 1)
      return true
    },

    async listZones(tripId) {
      return db.zones.filter((z) => z.trip_id === tripId).map((z) => structuredClone(z))
    },

    async getZone(tripId, zoneId) {
      return db.zones.find((z) => z.id === zoneId && z.trip_id === tripId) ?? null
    },

    async createZone(input: ZoneInput) {
      const zone: Zone = {
        id: randomUUID(),
        trip_id: input.trip_id,
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

    async updateZone(tripId, zoneId, patch) {
      // Scoped by trip, like getZone: a zone id from another trip must read as
      // "no such zone" rather than being quietly writable.
      const zone = db.zones.find((z) => z.id === zoneId && z.trip_id === tripId)
      if (!zone) return null
      if (patch.image_url !== undefined) zone.image_url = patch.image_url ?? null
      return structuredClone(zone)
    },

    async countPlacesByCategory(tripId, zoneId) {
      const counts = emptyCounts()
      if (!zoneIn(tripId, zoneId)) return counts
      for (const p of db.places) if (p.zone_id === zoneId) counts[p.category]++
      return counts
    },

    async listPlaces(tripId, zoneId, category) {
      if (!zoneIn(tripId, zoneId)) return []
      return db.places.filter((p) => p.zone_id === zoneId && p.category === category)
    },

    async listPlacesInZone(tripId, zoneId) {
      if (!zoneIn(tripId, zoneId)) return []
      return db.places.filter((p) => p.zone_id === zoneId)
    },

    async getPlace(tripId, placeId) {
      const place = db.places.find((p) => p.id === placeId)
      return place && zoneIn(tripId, place.zone_id) ? place : null
    },

    async listPlaceIdsByCategory(tripId, category) {
      return placesIn(tripId)
        .filter((p) => p.category === category)
        .map((p) => p.id)
    },

    async createPlace(tripId, input: PlaceInput) {
      if (!zoneIn(tripId, input.zone_id)) throw new Error('zone does not belong to this trip')
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

    async updatePlace(tripId, placeId, patch) {
      const place = db.places.find((p) => p.id === placeId)
      if (!place || !zoneIn(tripId, place.zone_id)) return null
      // Both ends have to be in this trip, or a place could be moved into
      // someone else's city.
      if (patch.zone_id !== undefined && !zoneIn(tripId, patch.zone_id)) return null
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

    async deletePlace(tripId, placeId) {
      const idx = db.places.findIndex((p) => p.id === placeId && zoneIn(tripId, p.zone_id))
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

    async getItineraryItem(tripId, itemId) {
      const item = db.itinerary!.find((i) => i.id === itemId && i.trip_id === tripId)
      return item ? structuredClone(item) : null
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

    async updateItineraryItem(tripId, itemId, patch) {
      const item = db.itinerary!.find((i) => i.id === itemId && i.trip_id === tripId)
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

    async deleteItineraryItem(tripId, itemId) {
      const i = db.itinerary!.findIndex((x) => x.id === itemId && x.trip_id === tripId)
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

    async updateShoppingItem(tripId, itemId, patch) {
      const item = db.shopping!.find((s) => s.id === itemId && s.trip_id === tripId)
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

    async deleteShoppingItem(tripId, itemId) {
      const i = db.shopping!.findIndex((s) => s.id === itemId && s.trip_id === tripId)
      if (i === -1) return false
      db.shopping!.splice(i, 1)
      return true
    },

    async listTips(tripId, parent) {
      if ('zone_id' in parent) {
        if (!zoneIn(tripId, parent.zone_id)) return []
        return db.tips.filter((t) => t.zone_id === parent.zone_id)
      }
      if (!placeIn(tripId, parent.place_id)) return []
      return db.tips.filter((t) => t.place_id === parent.place_id)
    },

    async createTip(tripId, input: TipInput) {
      const parentInTrip = input.zone_id
        ? zoneIn(tripId, input.zone_id)
        : !!input.place_id && placeIn(tripId, input.place_id)
      if (!parentInTrip) throw new Error('tip parent does not belong to this trip')
      const tip: Tip = {
        id: randomUUID(),
        zone_id: input.zone_id ?? null,
        place_id: input.place_id ?? null,
        body: input.body,
      }
      db.tips.push(tip)
      return structuredClone(tip)
    },

    async updateTip(tripId, tipId, body) {
      const tip = db.tips.find((t) => t.id === tipId && tipIn(tripId, t))
      if (!tip) return null
      tip.body = body
      return structuredClone(tip)
    },

    async deleteTip(tripId, tipId) {
      const idx = db.tips.findIndex((t) => t.id === tipId && tipIn(tripId, t))
      if (idx === -1) return false
      db.tips.splice(idx, 1)
      return true
    },

    async listFiles(tripId, parent) {
      const mine = db.files.filter((f) => fileIn(tripId, f))
      if ('trip_id' in parent) return mine.filter((f) => f.trip_id === parent.trip_id)
      if ('zone_id' in parent) return mine.filter((f) => f.zone_id === parent.zone_id)
      return mine.filter((f) => f.place_id === parent.place_id)
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

    async getFile(tripId, fileId) {
      return db.files.find((f) => f.id === fileId && fileIn(tripId, f)) ?? null
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

    async deleteFile(tripId, fileId) {
      const idx = db.files.findIndex((f) => f.id === fileId && fileIn(tripId, f))
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

    async getLatestRates(base: string) {
      const found = latestRates.get(base.toUpperCase())
      return found ? structuredClone(found) : null
    },

    async saveRates(rates: ExchangeRates) {
      latestRates.set(rates.base.toUpperCase(), structuredClone(rates))
    },

    async listReminders(tripId) {
      return db
        .reminders!.filter((r) => r.trip_id === tripId)
        .sort((a, b) => (a.remind_at < b.remind_at ? -1 : a.remind_at > b.remind_at ? 1 : 0))
        .map((r) => structuredClone(r))
    },

    async getReminder(tripId, reminderId) {
      const found = db.reminders!.find((r) => r.id === reminderId && r.trip_id === tripId)
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

    async updateReminder(tripId, reminderId, patch) {
      const reminder = db.reminders!.find((r) => r.id === reminderId && r.trip_id === tripId)
      if (!reminder) return null
      if (patch.title !== undefined) reminder.title = patch.title
      if (patch.body !== undefined) reminder.body = patch.body ?? null
      if (patch.url !== undefined) reminder.url = patch.url ?? null
      if (patch.remind_at !== undefined) reminder.remind_at = patch.remind_at
      if (patch.time_zone !== undefined) reminder.time_zone = patch.time_zone ?? 'UTC'
      if (patch.sent_at !== undefined) reminder.sent_at = patch.sent_at
      return structuredClone(reminder)
    },

    async deleteReminder(tripId, reminderId) {
      const idx = db.reminders!.findIndex((r) => r.id === reminderId && r.trip_id === tripId)
      if (idx === -1) return false
      db.reminders!.splice(idx, 1)
      return true
    },

    async claimDueReminders(nowIso) {
      const due = db.reminders!.filter((r) => r.sent_at === null && r.remind_at <= nowIso)
      for (const r of due) r.sent_at = nowIso
      return due.map((r) => structuredClone(r))
    },

    async listPushSubscriptionsForUsers(userIds) {
      const wanted = new Set(userIds)
      return subscriptions.filter((s) => wanted.has(s.user_id)).map((s) => ({ ...s }))
    },

    async savePushSubscription(input: PushSubscriptionInput) {
      const existing = subscriptions.find((s) => s.endpoint === input.endpoint)
      if (existing) {
        // The endpoint is the identity of the device, not of the person: a
        // shared phone re-subscribing under a second account moves with them.
        existing.user_id = input.user_id
        existing.p256dh = input.p256dh
        existing.auth = input.auth
        if (input.label !== undefined) existing.label = input.label ?? null
        return { ...existing }
      }
      const record: PushSubscriptionRecord = {
        id: randomUUID(),
        user_id: input.user_id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        label: input.label ?? null,
        created_at: new Date().toISOString(),
      }
      subscriptions.push(record)
      return { ...record }
    },

    async deletePushSubscription(userId, endpoint) {
      const idx = subscriptions.findIndex((s) => s.endpoint === endpoint && s.user_id === userId)
      if (idx === -1) return false
      subscriptions.splice(idx, 1)
      return true
    },

    async search(tripId, query) {
      const q = query.trim().toLowerCase()
      const has = (s?: string | null) => !!s && s.toLowerCase().includes(q)
      return {
        places: placesIn(tripId).filter(
          (p) => has(p.name) || has(p.name_ja) || has(p.description) || has(p.address)
        ),
        zones: db.zones
          .filter((z) => z.trip_id === tripId)
          .filter((z) => has(z.name) || has(z.name_ja) || has(z.summary)),
        tips: db.tips.filter((t) => has(t.body) && tipIn(tripId, t)),
      }
    },
  }
}
