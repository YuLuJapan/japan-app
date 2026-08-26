// Datastore interface — every service depends on this, never on a concrete
// backend. DATA_BACKEND=memory (placeholder JSON, default) | supabase (Phase 8).
import type { FlightInfo } from './flight.js'
import type { InviteRole, TripRole } from './permissions.js'

export const CATEGORIES = ['hotel', 'attraction', 'food', 'shopping', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

/** A free-text traveller on a trip — not a linked account. Email is optional and is
 *  only ever used to open a mailto: invite; the app has no per-traveller login. */
export interface Traveller {
  name: string
  email?: string
}

/**
 * A person with an account. Mirrors the Supabase Auth user for the fields the
 * app itself owns — upserted on first authenticated request rather than by a
 * trigger, so the memory backend behaves identically (lib/identity.ts).
 *
 * Distinct from `Traveller`: a Traveller is a free-text name on a trip's
 * roster, a Profile is a login. Someone can be either, both, or neither.
 */
export interface Profile {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  /** When this account accepted the terms, or null if it never has. */
  accepted_terms_at?: string | null
  /** Which version was accepted — see lib/terms.ts for why both are stored. */
  accepted_terms_version?: string | null
}

export interface ProfileInput {
  id: string
  email: string
  display_name?: string | null
  avatar_url?: string | null
}

/**
 * One account's membership of one trip. The table that replaced the
 * TRIP_OWNER_EMAILS allow-list: the app no longer asks "is this email one of
 * the travellers?" but "is this account a member of this trip?", which is what
 * lets anyone register without seeing anyone else's trip.
 *
 * `role` controls which verbs; the `can_see_*` flags control which content and
 * apply to viewers only (see lib/permissions.ts and, from phase 4,
 * lib/trip-view.ts).
 */
export interface TripMember {
  trip_id: string
  user_id: string
  role: TripRole
  can_see_stays: boolean
  can_see_flight: boolean
  can_see_documents: boolean
  can_see_shopping: boolean
}

export interface TripMemberInput {
  trip_id: string
  user_id: string
  role: TripRole
  can_see_stays?: boolean
  can_see_flight?: boolean
  can_see_documents?: boolean
  can_see_shopping?: boolean
}

/**
 * A pending (or spent) invitation to a trip.
 *
 * `token_hash` is a SHA-256 of the token; the plaintext exists only in the
 * response that mints it. Nothing in the app can recover a token from a row,
 * which is the point — a leaked backup hands out no working invites.
 */
export interface TripInvite {
  id: string
  trip_id: string
  /** null = an open link; set = only that address may accept it. */
  email: string | null
  role: InviteRole
  can_see_stays: boolean
  can_see_flight: boolean
  can_see_documents: boolean
  can_see_shopping: boolean
  invited_by: string | null
  expires_at: string
  accepted_at: string | null
  accepted_by: string | null
  /** The inviter withdrew it. */
  revoked_at: string | null
  /** The invitee said no. Distinct from revoked: the inviter deserves to know which. */
  declined_at: string | null
  created_at: string
}

/**
 * What a backend persists. `token_hash` is deliberately absent from
 * `TripInvite` itself, so the hash cannot travel out of a store by accident —
 * no service or route can reach a field its type does not have.
 */
export interface StoredTripInvite extends TripInvite {
  token_hash: string
}

export interface TripInviteInput {
  trip_id: string
  email?: string | null
  role: InviteRole
  can_see_stays?: boolean
  can_see_flight?: boolean
  can_see_documents?: boolean
  can_see_shopping?: boolean
  token_hash: string
  invited_by: string | null
  expires_at: string
}

export interface Trip {
  id: string
  /** An override, not the title — see lib/trip-title.ts. Null means "build one". */
  name: string | null
  country: string | null
  start_date: string
  end_date: string
  description: string | null
  people: Traveller[]
  /**
   * The booking, or null when none is attached. Stored as jsonb (migration
   * 0017) and read through `normalizeFlight`, which is the only place its
   * shape is enforced. Written from the trip form.
   */
  flight: FlightInfo | null
  /** 'HH:MM' the trip begins, in `start_tz`; null for "no particular time". */
  start_time: string | null
  /** IANA zone for `start_time` — the pair is what makes the countdown stable. */
  start_tz: string | null
  /**
   * What money is spent in at the destination — the exchange calculator's
   * input side. Defaults to JPY, which is what every trip was before it could
   * be chosen (lib/currencies.ts).
   */
  local_currency: string
  /** What to convert into: 1–3 codes, the calculator's output cards. */
  home_currencies: string[]
}

export interface TripInput {
  name?: string | null
  country?: string | null
  start_date: string
  end_date: string
  description?: string | null
  people?: Traveller[]
  local_currency?: string
  home_currencies?: string[]
  /** The booking, or null to clear it. Absent means "leave it alone". */
  flight?: FlightInfo | null
  /** 'HH:MM' the trip begins, in `start_tz`. Null for "no particular time". */
  start_time?: string | null
  /** IANA zone `start_time` is written in. Meaningless without it. */
  start_tz?: string | null
}

/** Coerces a legacy plain-string traveller (old seed/DB rows) or a loose object into a Traveller. */
export function normalizeTraveller(p: unknown): Traveller {
  if (typeof p === 'string') return { name: p }
  if (p && typeof p === 'object') {
    const obj = p as { name?: unknown; email?: unknown }
    const name = typeof obj.name === 'string' ? obj.name : ''
    const email = typeof obj.email === 'string' ? obj.email.trim() : ''
    return email ? { name, email } : { name }
  }
  return { name: '' }
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
  trip_id: string
  name: string
  name_ja: string | null
  summary: string | null
  image_url?: string | null
  lat?: number | null
  lng?: number | null
}

export interface ZoneInput {
  trip_id: string
  name: string
  name_ja?: string | null
  summary?: string | null
  image_url?: string | null
  lat?: number | null
  lng?: number | null
}

/** What may be changed on an existing zone. Absent means "leave it alone". */
export interface ZonePatch {
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

// Shopping list ("things to buy in Japan") — trip-level, not tied to a zone.
export const SHOPPING_CATEGORIES = [
  'clothes',
  'haircare',
  'skincare',
  'health',
  'snacks',
  'tech',
  'home',
  'souvenir',
  'other',
] as const
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number]

export interface ShoppingItem {
  id: string
  trip_id: string
  name: string
  category: ShoppingCategory
  note: string | null // which model/size/colour, why we want it
  shop: string | null // where to buy it ("Uniqlo Ginza", "Don Quijote")
  zone_id: string | null // optional city the shop is in
  price_yen: number | null // what it should cost, in yen
  url: string | null // product/reference link
  image_url: string | null
  bought: boolean
  position: number
}

export interface ShoppingItemInput {
  trip_id: string
  name: string
  category?: ShoppingCategory
  note?: string | null
  shop?: string | null
  zone_id?: string | null
  price_yen?: number | null
  url?: string | null
  image_url?: string | null
  bought?: boolean
  position?: number
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
  /** The currency amounts are quoted *from* (a trip's local currency). */
  base: string
  date: string // YYYY-MM-DD
  /** 1 unit of `base` in each currency, keyed by uppercase ISO code. */
  rates: Record<string, number>
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

/**
 * One browser's push endpoint (one row per installed app / device), and the
 * account that registered it. `user_id` is what keeps a reminder from reaching
 * a phone that has no business with the trip — see `listPushSubscriptionsForUsers`.
 */
export interface PushSubscriptionRecord {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  label: string | null
  created_at: string
}

export interface PushSubscriptionInput {
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  label?: string | null
}

export type FileUrlResult = { url: string; expires_in: number } | 'FILE_MISSING'
export type FileBytesResult = { bytes: Buffer; mime_type: string } | 'FILE_MISSING'

export interface DataStore {
  /** Trivial read used by /api/health (keep-alive). Throws if the backend is unreachable. */
  ping(): Promise<void>

  getProfile(userId: string): Promise<Profile | null>
  /** Case-insensitive — how an invite finds the account it was addressed to. */
  getProfileByEmail(email: string): Promise<Profile | null>
  /**
   * Create or refresh the row for a signed-in user. Called on the first
   * authenticated request of a session, so it must stay cheap and idempotent.
   */
  upsertProfile(input: ProfileInput): Promise<Profile>
  /** Stamps this account as having accepted `version` of the terms, now. */
  acceptTerms(userId: string, version: string, at: string): Promise<Profile | null>

  /**
   * The caller's trips, oldest first. Powers the "Where to next?" trips list.
   *
   * There is deliberately no unscoped `listTrips()` — the deprecated access
   * codes were the only caller that could see one, and leaving it behind would
   * leave a method whose only correct number of call sites is zero.
   */
  listTripsForUser(userId: string): Promise<Trip[]>

  listMembershipsForUser(userId: string): Promise<TripMember[]>

  /** Pending invites for a trip, newest first. Spent and revoked ones are excluded. */
  listTripInvites(tripId: string): Promise<TripInvite[]>
  /**
   * Every invitation addressed to this email, across every trip — the
   * invitee's side of the table. Matched case-insensitively, because email
   * addresses are.
   *
   * Unscoped by trip on purpose: an invitation is addressed to a person, and
   * the caller has proved they hold that address. Filtering to open ones is
   * the service's job, so it can say "expired" rather than "no such thing".
   */
  listInvitesForEmail(email: string): Promise<TripInvite[]>
  /** The only lookup the accept flow does — by hash, never by id. */
  getInviteByTokenHash(tokenHash: string): Promise<TripInvite | null>
  getTripInvite(tripId: string, inviteId: string): Promise<TripInvite | null>
  /**
   * One invitation by id, without naming its trip — the invitee does not know
   * the trip yet, and is authorized by the address on the invitation rather
   * than by membership. Exactly the same shape of claim as
   * `getInviteByTokenHash`, which is authorized by holding the token.
   */
  getInviteById(inviteId: string): Promise<TripInvite | null>
  createTripInvite(input: TripInviteInput): Promise<TripInvite>
  /** Stamps `accepted_at`/`accepted_by`, or `revoked_at`. Single-use is enforced here. */
  updateTripInvite(
    inviteId: string,
    patch: {
      accepted_at?: string
      accepted_by?: string
      revoked_at?: string
      declined_at?: string
    }
  ): Promise<TripInvite | null>
  listTripMembers(tripId: string): Promise<TripMember[]>
  getTripMember(tripId: string, userId: string): Promise<TripMember | null>
  /** Idempotent: re-adding an existing member updates their role and visibility. */
  upsertTripMember(input: TripMemberInput): Promise<TripMember>
  removeTripMember(tripId: string, userId: string): Promise<boolean>
  getTrip(tripId: string): Promise<Trip | null>
  createTrip(input: TripInput): Promise<Trip>
  updateTrip(tripId: string, patch: Partial<TripInput>): Promise<Trip | null>
  /** Hard delete. Cascades to the trip's steps/itinerary/shopping/reminders/files. */
  deleteTrip(tripId: string): Promise<boolean>

  listSteps(tripId: string): Promise<JourneyStep[]>
  getStep(tripId: string, stepId: string): Promise<JourneyStep | null>
  createStep(input: JourneyStepInput): Promise<JourneyStep>
  updateStep(
    tripId: string,
    stepId: string,
    patch: Partial<JourneyStepInput>
  ): Promise<JourneyStep | null>
  /** Hard delete. Callers are responsible for compacting positions afterward. */
  deleteStep(tripId: string, stepId: string): Promise<boolean>

  /**
   * Every zone belonging to this trip (used to find-or-create a zone for a
   * free-text destination).
   *
   * Since 0013 a zone belongs to exactly one trip. That is what lets every
   * method below take the trip id as its first argument: scope lives in the
   * query, so a forgotten check is a type error rather than a code review note.
   */
  listZones(tripId: string): Promise<Zone[]>
  getZone(tripId: string, zoneId: string): Promise<Zone | null>
  /** Create a zone on the fly for a destination that doesn't match an existing one. */
  createZone(input: ZoneInput): Promise<Zone>
  /** Patches one zone, scoped to its trip. Null for a zone that isn't in it. */
  updateZone(tripId: string, zoneId: string, patch: ZonePatch): Promise<Zone | null>
  countPlacesByCategory(tripId: string, zoneId: string): Promise<Record<Category, number>>

  listPlaces(tripId: string, zoneId: string, category: Category): Promise<Place[]>
  /** Every place in a zone, all categories (used by the city map). */
  listPlacesInZone(tripId: string, zoneId: string): Promise<Place[]>
  getPlace(tripId: string, placeId: string): Promise<Place | null>
  /** Ids of every place in one category — one query, so a restricted view can drop stays cheaply. */
  listPlaceIdsByCategory(tripId: string, category: Category): Promise<string[]>
  createPlace(tripId: string, input: PlaceInput): Promise<Place>
  updatePlace(tripId: string, placeId: string, patch: Partial<PlaceInput>): Promise<Place | null>
  /** Hard delete; the place's tips are deleted with it. Returns false if not found. */
  deletePlace(tripId: string, placeId: string): Promise<boolean>

  listItinerary(tripId: string): Promise<ItineraryItem[]>
  getItineraryItem(tripId: string, itemId: string): Promise<ItineraryItem | null>
  createItineraryItem(input: ItineraryItemInput): Promise<ItineraryItem>
  updateItineraryItem(
    tripId: string,
    itemId: string,
    patch: Partial<ItineraryItemInput>
  ): Promise<ItineraryItem | null>
  deleteItineraryItem(tripId: string, itemId: string): Promise<boolean>

  listShoppingItems(tripId: string): Promise<ShoppingItem[]>
  createShoppingItem(input: ShoppingItemInput): Promise<ShoppingItem>
  updateShoppingItem(
    tripId: string,
    itemId: string,
    patch: Partial<ShoppingItemInput>
  ): Promise<ShoppingItem | null>
  deleteShoppingItem(tripId: string, itemId: string): Promise<boolean>

  listTips(tripId: string, parent: { zone_id: string } | { place_id: string }): Promise<Tip[]>
  createTip(tripId: string, input: TipInput): Promise<Tip>
  updateTip(tripId: string, tipId: string, body: string): Promise<Tip | null>
  deleteTip(tripId: string, tipId: string): Promise<boolean>

  listFiles(
    tripId: string,
    parent: { trip_id: string } | { zone_id: string } | { place_id: string }
  ): Promise<FileAttachment[]>
  /**
   * Every file for the trip regardless of parent (used by the Documents view):
   * files attached directly to the trip, plus files on any zone/place visited
   * by one of the trip's steps.
   */
  listAllFiles(tripId: string): Promise<FileAttachment[]>
  countTripFiles(tripId: string): Promise<number>
  getFile(tripId: string, fileId: string): Promise<FileAttachment | null>
  /** Store an uploaded blob and its metadata row. */
  createFile(input: FileInput, bytes: Buffer): Promise<FileAttachment>
  /**
   * Rename a file. Only the display name is changeable — `storage_path` is a
   * uuid the blob is keyed by, so a rename never touches what was uploaded.
   * Null when the row is missing or belongs to another trip.
   */
  updateFile(
    tripId: string,
    fileId: string,
    patch: { display_name: string }
  ): Promise<FileAttachment | null>
  /** Delete the metadata row and its blob. Returns false if the row is missing. */
  deleteFile(tripId: string, fileId: string): Promise<boolean>
  /** Move a place's files to the trip (used before place deletion — no silent file loss). */
  reparentFilesToTrip(placeId: string, tripId: string): Promise<void>
  /** Resolve an openable URL for the blob, or FILE_MISSING when the row exists but the blob is gone. */
  getFileUrl(file: FileAttachment): Promise<FileUrlResult>
  /** Raw bytes for the blob, streamed by GET /api/files/:id/content so the app can preview it inline. */
  getFileBytes(file: FileAttachment): Promise<FileBytesResult>

  /** Free-text search across one trip's places, zones and tips (case-insensitive). */
  search(tripId: string, query: string): Promise<{ places: Place[]; zones: Zone[]; tips: Tip[] }>

  /** Last exchange rate we successfully fetched (durable fallback), or null. */
  /** The last rate stored for this base currency, or null if none ever was. */
  getLatestRates(base: string): Promise<ExchangeRates | null>
  /** Persist the latest fetched exchange rate (one row per base currency). */
  saveRates(rates: ExchangeRates): Promise<void>

  /** Every reminder for the trip, soonest first. */
  listReminders(tripId: string): Promise<Reminder[]>
  getReminder(tripId: string, reminderId: string): Promise<Reminder | null>
  createReminder(input: ReminderInput): Promise<Reminder>
  updateReminder(
    tripId: string,
    reminderId: string,
    patch: Partial<ReminderInput> & { sent_at?: string | null }
  ): Promise<Reminder | null>
  deleteReminder(tripId: string, reminderId: string): Promise<boolean>
  /**
   * Atomically hand out every unsent reminder whose time has come, stamping
   * `sent_at` in the same operation. Claim-then-send means a reminder is sent
   * at most once even if two dispatch runs overlap (at-most-once, by design:
   * a duplicate notification is worse than a missed retry here).
   */
  claimDueReminders(nowIso: string): Promise<Reminder[]>

  /**
   * Every device belonging to any of these accounts. There is deliberately no
   * unscoped `listPushSubscriptions()`: dispatch used to call one, which is
   * how every due reminder reached every registered device regardless of whose
   * trip it was. Asking for a specific set of people makes that mistake
   * unavailable rather than merely discouraged.
   *
   * An empty list returns no rows — never everything.
   */
  listPushSubscriptionsForUsers(userIds: readonly string[]): Promise<PushSubscriptionRecord[]>
  /**
   * Upsert by endpoint — re-subscribing the same device refreshes its keys,
   * and re-stamps the account, so a device that changes hands follows the
   * person now signed in.
   */
  savePushSubscription(input: PushSubscriptionInput): Promise<PushSubscriptionRecord>
  /**
   * Drop a device (its owner disabled notifications, or the push service said
   * 410 Gone). Scoped to the account, so one person can never unregister
   * another's phone by naming its endpoint.
   */
  deletePushSubscription(userId: string, endpoint: string): Promise<boolean>
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
