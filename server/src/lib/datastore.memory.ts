// Placeholder in-memory datastore (DATA_BACKEND=memory, the default).
// Loads server/src/data/placeholder-data.json at startup and applies mutations
// in memory only — state resets on restart. Durable persistence arrives with
// the Supabase implementation in the infrastructure-activation phase.
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AiUsageInput,
  AiUsageRow,
  Category,
  ChatMessage,
  ChatMessageInput,
  ChatThread,
  DataStore,
  Profile,
  StoredTripInvite,
  TripMember,
  ExchangeRates,
  FileAttachment,
  FileBytesResult,
  FileInput,
  FileUrlResult,
  Activity,
  ActivityInput,
  JourneyStep,
  JourneyStepInput,
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
  activities: Activity[]
  tips: Tip[]
  files: FileAttachment[]
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

// A day plan: by day, then timed items (ascending) before untimed, then manual
// position, then id. Only scheduled activities are ever sorted with this.
function compareScheduled(a: Activity, b: Activity): number {
  if (a.day !== b.day) return (a.day ?? '') < (b.day ?? '') ? -1 : 1
  if (a.start_time !== b.start_time) {
    if (a.start_time === null) return 1
    if (b.start_time === null) return -1
    return a.start_time < b.start_time ? -1 : 1
  }
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}

// Explore's order, for activities with no date: by category in the app's own
// order, then manual position, then name, then id. Two orders rather than one
// comparator with a null branch, because they belong to two lists — a day plan
// and a saved list — and `src/lib/ordering.ts` mirrors both.
function compareSaved(a: Activity, b: Activity): number {
  const rank = (c: Category | null) => (c === null ? CATEGORIES.length : CATEGORIES.indexOf(c))
  if (rank(a.category) !== rank(b.category)) return rank(a.category) - rank(b.category)
  if (a.position !== b.position) return a.position - b.position
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.id < b.id ? -1 : 1
}

/**
 * The one list every screen filters. Scheduled activities come first in day
 * order, then the saved ones in Explore order — one array, two orders, so a
 * caller never has to ask which list it is reading.
 */
function compareActivities(a: Activity, b: Activity): number {
  if ((a.day === null) !== (b.day === null)) return a.day === null ? 1 : -1
  return a.day === null ? compareSaved(a, b) : compareScheduled(a, b)
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
  db.activities ??= [] // optional in older fixtures
  db.shopping ??= []
  db.reminders ??= []
  // Backfill columns added after some fixtures/seed rows were written. A JSON
  // row simply lacks a key the Postgres column would read as NULL, and
  // `undefined` is not `null` — every read below assumes the field is there.
  for (const a of db.activities) {
    a.day ??= null
    a.zone_id ??= null
    a.category ??= null
    a.name_ja ??= null
    a.description ??= null
    a.address ??= null
    a.links ??= []
    a.image_url ??= null
    a.lat ??= null
    a.lng ??= null
    a.start_time ??= null
    a.position ??= 0
    a.highlight ??= false
    a.icon ??= null
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
  // Chat (005). Not part of MemoryData: a conversation is not seeded content,
  // and a fixture that shipped one would make every access test start from a
  // state no real trip begins in.
  const chatThreads: ChatThread[] = []
  const chatMessages: ChatMessage[] = []

  /**
   * The one conversation a trip can still be added to.
   *
   * The memory-store half of `chat_threads_one_active_per_trip` (migration
   * 0024). Every chat method here goes through it rather than matching on
   * `trip_id`, which after archiving would match more than one row.
   */
  const activeThread = (tripId: string) =>
    chatThreads.find((t) => t.trip_id === tripId && !t.archived_at)
  const aiUsage: AiUsageRow[] = []

  // Since migration 0013 a zone belongs to exactly one trip, so "is this row
  // in that trip?" is a zone lookup for anything hanging off a zone.
  const zoneIn = (tripId: string, zoneId: string) =>
    db.zones.some((z) => z.id === zoneId && z.trip_id === tripId)
  // An activity carries its own trip id (the column places never had), so this
  // is a direct match rather than a hop through the zone.
  const activitiesIn = (tripId: string) => db.activities.filter((a) => a.trip_id === tripId)
  const activityIn = (tripId: string, activityId: string) =>
    db.activities.some((a) => a.id === activityId && a.trip_id === tripId)
  /** A tip hangs off exactly one parent, and inherits that parent's trip. */
  const tipIn = (tripId: string, tip: Tip) =>
    tip.zone_id
      ? zoneIn(tripId, tip.zone_id)
      : !!tip.activity_id && activityIn(tripId, tip.activity_id)
  /** A file hangs off the trip directly, or off one of its zones or activities. */
  const fileIn = (tripId: string, f: FileAttachment) =>
    f.trip_id === tripId ||
    (!!f.zone_id && zoneIn(tripId, f.zone_id)) ||
    (!!f.activity_id && activityIn(tripId, f.activity_id))

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
      db.activities = (db.activities ?? []).filter((a) => a.trip_id !== tripId)
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

    async countSavedByCategory(tripId, zoneId) {
      const counts = emptyCounts()
      if (!zoneIn(tripId, zoneId)) return counts
      // Saved only: Explore means "not yet on a day", so a count that included
      // scheduled rows would name rows the list does not show.
      for (const a of db.activities) {
        if (a.trip_id !== tripId || a.zone_id !== zoneId || a.day !== null) continue
        counts[a.category ?? 'other']++
      }
      return counts
    },

    async listActivities(tripId) {
      return activitiesIn(tripId)
        .map((a) => structuredClone(a))
        .sort(compareActivities)
    },

    async getActivity(tripId, activityId) {
      const found = db.activities.find((a) => a.id === activityId && a.trip_id === tripId)
      return found ? structuredClone(found) : null
    },

    async listActivityIdsByCategory(tripId, category) {
      return activitiesIn(tripId)
        .filter((a) => a.category === category)
        .map((a) => a.id)
    },

    async createActivity(input: ActivityInput) {
      // Both ends have to be in the trip, or an activity could be filed in
      // someone else's city.
      if (input.zone_id != null && !zoneIn(input.trip_id, input.zone_id)) {
        throw new Error('zone does not belong to this trip')
      }
      const activity: Activity = {
        id: randomUUID(),
        trip_id: input.trip_id,
        zone_id: input.zone_id ?? null,
        category: input.category ?? null,
        name: input.name,
        name_ja: input.name_ja ?? null,
        description: input.description ?? null,
        address: input.address ?? null,
        links: input.links ?? [],
        image_url: input.image_url ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        day: input.day ?? null,
        start_time: input.start_time ?? null,
        position: input.position ?? 0,
        highlight: input.highlight ?? false,
        icon: input.icon ?? null,
      }
      db.activities.push(activity)
      return structuredClone(activity)
    },

    async updateActivity(tripId, activityId, patch) {
      const activity = db.activities.find((a) => a.id === activityId && a.trip_id === tripId)
      if (!activity) return null
      if (patch.zone_id != null && !zoneIn(tripId, patch.zone_id)) return null
      // last write wins (spec edge case: concurrent edits)
      if (patch.zone_id !== undefined) activity.zone_id = patch.zone_id ?? null
      if (patch.category !== undefined) activity.category = patch.category ?? null
      if (patch.name !== undefined) activity.name = patch.name
      if (patch.name_ja !== undefined) activity.name_ja = patch.name_ja ?? null
      if (patch.description !== undefined) activity.description = patch.description ?? null
      if (patch.address !== undefined) activity.address = patch.address ?? null
      if (patch.links !== undefined) activity.links = patch.links ?? []
      if (patch.image_url !== undefined) activity.image_url = patch.image_url ?? null
      if (patch.lat !== undefined) activity.lat = patch.lat ?? null
      if (patch.lng !== undefined) activity.lng = patch.lng ?? null
      // Setting or clearing the date is what moves a row between the day plan
      // and Explore — the one write in the app that changes which list it is in.
      if (patch.day !== undefined) activity.day = patch.day ?? null
      if (patch.start_time !== undefined) activity.start_time = patch.start_time ?? null
      if (patch.position !== undefined) activity.position = patch.position ?? 0
      if (patch.highlight !== undefined) activity.highlight = patch.highlight ?? false
      if (patch.icon !== undefined) activity.icon = patch.icon ?? null
      return structuredClone(activity)
    },

    async deleteActivity(tripId, activityId) {
      const idx = db.activities.findIndex((a) => a.id === activityId && a.trip_id === tripId)
      if (idx === -1) return false
      db.activities.splice(idx, 1)
      db.tips = db.tips.filter((t) => t.activity_id !== activityId) // cascade
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
      if (!activityIn(tripId, parent.activity_id)) return []
      return db.tips.filter((t) => t.activity_id === parent.activity_id)
    },

    // Every tip in the trip, both parents at once — the export's sweep, and
    // the only read that does not name a parent.
    async listAllTips(tripId) {
      return db.tips.filter((t) => tipIn(tripId, t))
    },

    async createTip(tripId, input: TipInput) {
      const parentInTrip = input.zone_id
        ? zoneIn(tripId, input.zone_id)
        : !!input.activity_id && activityIn(tripId, input.activity_id)
      if (!parentInTrip) throw new Error('tip parent does not belong to this trip')
      const tip: Tip = {
        id: randomUUID(),
        zone_id: input.zone_id ?? null,
        activity_id: input.activity_id ?? null,
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
      return mine.filter((f) => f.activity_id === parent.activity_id)
    },

    async listAllFiles(tripId) {
      const zoneIds = new Set(db.steps.filter((s) => s.trip_id === tripId).map((s) => s.zone_id))
      const activityIds = new Set(activitiesIn(tripId).map((a) => a.id))
      return db.files
        .filter(
          (f) =>
            f.trip_id === tripId ||
            (f.zone_id && zoneIds.has(f.zone_id)) ||
            (f.activity_id && activityIds.has(f.activity_id))
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
        activity_id: input.activity_id ?? null,
        display_name: input.display_name,
        storage_path: input.storage_path,
        mime_type: input.mime_type,
        size_bytes: input.size_bytes,
      }
      db.files.push(file)
      blobs.set(file.id, { bytes, mime: file.mime_type })
      return structuredClone(file)
    },

    async updateFile(tripId, fileId, patch) {
      const file = db.files.find((f) => f.id === fileId && fileIn(tripId, f))
      if (!file) return null
      file.display_name = patch.display_name
      return structuredClone(file)
    },

    async deleteFile(tripId, fileId) {
      const idx = db.files.findIndex((f) => f.id === fileId && fileIn(tripId, f))
      if (idx === -1) return false
      db.files.splice(idx, 1)
      blobs.delete(fileId)
      return true
    },

    async reparentFilesToTrip(activityId, tripId) {
      for (const f of db.files) {
        if (f.activity_id === activityId) {
          f.activity_id = null
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

    // --- Chat (005) ---------------------------------------------------------

    async getActiveChatThread(tripId) {
      const thread = activeThread(tripId)
      return thread ? { ...thread } : null
    },

    async createChatThread(tripId) {
      const existing = activeThread(tripId)
      if (existing) return { ...existing }
      const thread: ChatThread = {
        id: randomUUID(),
        trip_id: tripId,
        turn_started_at: null,
        archived_at: null,
        created_at: new Date().toISOString(),
      }
      chatThreads.push(thread)
      return { ...thread }
    },

    async archiveChatThread(tripId) {
      const thread = activeThread(tripId)
      if (!thread) return false
      // Stamped and unlocked in one go. A lock left set on an archived row is
      // dead state nothing will ever clear — `releaseChatTurn` only ever looks
      // at the live thread.
      thread.archived_at = new Date().toISOString()
      thread.turn_started_at = null
      // The messages stay exactly where they are, pointing at this thread. That
      // is the difference between archiving and deleting, and the only reason
      // re-opening a conversation is possible later. Nothing touches `aiUsage`
      // either — see the note on `archiveChatThread` in datastore.ts.
      return true
    },

    async claimChatTurn(tripId, nowIso, staleMs) {
      const thread = activeThread(tripId)
      if (!thread) return null
      // A held lock only counts while it is fresh. Past the window the turn that
      // took it is assumed dead — its function timed out or the process went
      // away — and the lock is taken over rather than left holding the
      // conversation shut with no way back but a manual reset.
      if (thread.turn_started_at) {
        const age = Date.parse(nowIso) - Date.parse(thread.turn_started_at)
        if (age < staleMs) return null
      }
      thread.turn_started_at = nowIso
      return { ...thread }
    },

    async releaseChatTurn(tripId) {
      const thread = activeThread(tripId)
      if (thread) thread.turn_started_at = null
    },

    async listChatMessages(threadId) {
      // Insertion order, not a sort. A conversation is append-only and every
      // append is later than the last, so the array *is* the order.
      //
      // Sorting on `created_at` looks more careful and is worse: the question
      // and its answer are written milliseconds apart and routinely land on the
      // same ISO timestamp, at which point any tiebreak on a random uuid puts
      // the answer before the question about half the time.
      //
      // By thread, never by trip: a trip now holds every conversation it has
      // ever had, and filtering on `trip_id` would hand all of them back.
      return chatMessages.filter((m) => m.thread_id === threadId).map((m) => ({ ...m }))
    },

    async createChatMessage(input: ChatMessageInput) {
      const message: ChatMessage = {
        id: randomUUID(),
        thread_id: input.thread_id,
        trip_id: input.trip_id,
        user_id: input.user_id,
        role: input.role,
        content: input.content,
        created_at: new Date().toISOString(),
      }
      chatMessages.push(message)
      return { ...message }
    },

    async recordAiUsage(input: AiUsageInput) {
      const row: AiUsageRow = {
        id: randomUUID(),
        user_id: input.user_id,
        trip_id: input.trip_id ?? null,
        capability: input.capability,
        vendor: input.vendor,
        model: input.model,
        unit: input.unit,
        quantity: { ...input.quantity },
        cost_cents: input.cost_cents,
        created_at: new Date().toISOString(),
      }
      aiUsage.push(row)
      return { ...row, quantity: { ...row.quantity } }
    },

    async sumAiUsageCents(userId, sinceIso) {
      return aiUsage
        .filter((r) => r.user_id === userId && r.created_at >= sinceIso)
        .reduce((total, r) => total + r.cost_cents, 0)
    },

    async sumAllAiUsageCents(sinceIso) {
      return aiUsage
        .filter((r) => r.created_at >= sinceIso)
        .reduce((total, r) => total + r.cost_cents, 0)
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
        activities: activitiesIn(tripId).filter(
          (a) => has(a.name) || has(a.name_ja) || has(a.description) || has(a.address)
        ),
        zones: db.zones
          .filter((z) => z.trip_id === tripId)
          .filter((z) => has(z.name) || has(z.name_ja) || has(z.summary)),
        tips: db.tips.filter((t) => has(t.body) && tipIn(tripId, t)),
      }
    },
  }
}
