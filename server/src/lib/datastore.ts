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
  /**
   * The tag the traveller chose for this activity, shown as a coloured pill on
   * the day plan. Distinct from `place_category`, which is *derived* from the
   * linked place: this one is typed on the activity itself, so an entry that
   * points at nothing saved ("Whatever the konbini has") can still say it is
   * food. `other` is not offered — a tag nobody can read is not a tag.
   */
  category: Category | null
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
  category?: Category | null
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

/**
 * One conversation, shared by a trip's writers (feature 005).
 *
 * There is exactly one per trip, enforced by a unique constraint rather than by
 * a service rule. That is affordable because chat is limited to owners and
 * partners and writers always get the full view — so everyone who can open it
 * already sees the whole trip, and a shared transcript can reveal nothing.
 */
export interface ChatThread {
  id: string
  trip_id: string
  /**
   * The turn lock. Null when idle; an instant while a turn is running.
   *
   * A timestamp rather than a boolean: a turn whose serverless function died
   * would hold a boolean forever with no recovery but a manual reset, whereas a
   * timestamp is compared against a staleness window and expires on its own.
   */
  turn_started_at: string | null
  /**
   * When this conversation was finished with, or null while it is the live one.
   *
   * A trip has at most one unarchived thread — a partial unique index in
   * migration 0024, not a service rule, for the same reason 0023 made the
   * original one-per-trip rule a constraint. Archived threads keep their
   * messages: "start over" is not a delete, and the record of what the
   * travellers asked survives even though nothing reads it back yet.
   */
  archived_at: string | null
  created_at: string
}

/**
 * One message in that conversation.
 *
 * `content` is text **in our own shape** — never the provider's content blocks.
 * That is the whole portability story: persisting vendor blocks would put the
 * vendor inside the database, where no adapter can reach it, and changing
 * provider would become a migration over a live conversation.
 */
export interface ChatMessage {
  id: string
  thread_id: string
  trip_id: string
  /** Who wrote it. Null for the assistant, and null again once an author's account is gone. */
  user_id: string | null
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ChatMessageInput {
  thread_id: string
  trip_id: string
  user_id: string | null
  role: 'user' | 'assistant'
  content: string
}

/**
 * One row of what an AI call cost.
 *
 * Named for the capability rather than for chat, because it has to outlive this
 * feature: extraction (007) and image generation (backlog) share no unit with a
 * chat turn — tokens with a cache-read discount against whole images priced
 * orders of magnitude higher. One table with one comparable `cost_cents` column
 * is what lets the cap ask "what has this account spent this month" once.
 *
 * `cost_cents` is priced at **write** time from `lib/ai/models.ts`. Deriving it
 * on read would mean the cap query had to know every historical price, and a
 * rate change would retroactively rewrite what last month cost.
 */
export interface AiUsageRow {
  id: string
  /** The account charged. The cap is per account, so three trips share one budget. */
  user_id: string
  trip_id: string | null
  capability: 'chat'
  vendor: string
  /** The catalogue key, namespaced — `anthropic/claude-opus-5`. */
  model: string
  unit: 'tokens'
  quantity: Record<string, number>
  cost_cents: number
  created_at: string
}

export interface AiUsageInput {
  user_id: string
  trip_id?: string | null
  capability: 'chat'
  vendor: string
  model: string
  unit: 'tokens'
  quantity: Record<string, number>
  cost_cents: number
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
  /**
   * Every place in the trip, all zones, all categories — the export's single
   * sweep (`services/export.ts`).
   *
   * Sliced by zone it must read exactly as `listPlacesInZone` would have: the
   * relative order of one zone's rows is the same in both, which is what lets
   * the export nest them without re-sorting. `server/tests/ordering.test.ts`
   * holds the two together.
   */
  listAllPlaces(tripId: string): Promise<Place[]>
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
  /**
   * Every tip in the trip, zone-level and place-level alike, in the same order
   * `listTips` returns the same rows in.
   *
   * Added for the export (`services/export.ts`), which needs all of them at
   * once: fetching per parent means one query per zone plus one per place —
   * around 50 round trips for a real trip, inside a single serverless
   * invocation. `server/tests/ordering.test.ts` pins this against `listTips`
   * so the two implementations cannot drift.
   */
  listAllTips(tripId: string): Promise<Tip[]>
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

  /**
   * The trip's **live** conversation, or null when there is none — either
   * nobody has asked anything yet, or the last one was archived.
   *
   * Named for "active" rather than left as `getChatThread`, because since 0024
   * a trip can hold several and only one of them is the one being added to. A
   * method that quietly returned "one of them" is the kind of ambiguity that
   * shows up later as a conversation answering from the wrong history.
   */
  getActiveChatThread(tripId: string): Promise<ChatThread | null>
  /** Idempotent: a trip already holding a live thread gets that one back, never a second. */
  createChatThread(tripId: string): Promise<ChatThread>
  /**
   * Atomically take the turn lock, stamping `turn_started_at` in the same
   * operation, and hand back the thread — or null when a live turn already
   * holds it.
   *
   * Claim-then-run, for the same reason `claimDueReminders` claims before it
   * sends: a read followed by a write is exactly the race this exists to close,
   * and two turns against one conversation would answer interleaved histories
   * and bill for both.
   *
   * `staleMs` is what stops a turn whose function died from holding the lock
   * forever — a stamp older than that is treated as abandoned and taken over.
   */
  claimChatTurn(tripId: string, nowIso: string, staleMs: number): Promise<ChatThread | null>
  /** Release the lock. Called on every exit path, success and failure alike. */
  releaseChatTurn(tripId: string): Promise<void>
  /**
   * Finish with the live conversation: stamp `archived_at` and let go of the
   * lock in the same write.
   *
   * **Nothing is deleted.** The thread and every message in it stay exactly
   * where they are; what changes is that they are no longer the conversation
   * the app reads or the model is shown. Re-opening one is not built — there is
   * no route and no screen for it — but the rows are there for when it is, which
   * is the whole reason this is an archive rather than a delete.
   *
   * Returns whether there was a live one, so starting over on a trip nobody has
   * asked anything on is a no-op rather than an error: the button is idempotent
   * by construction, and two taps do not produce a failure on the second.
   *
   * **The ledger is not touched, and must never be.** `ai_usage` rows belong to
   * the account and the trip, not to the thread, so putting a conversation away
   * cannot move the monthly cap. Wire it the other way and "start over" becomes
   * the way around the one control that stops this feature spending money —
   * which is why `chat-threads.test.ts` asserts the budget afterwards rather
   * than trusting the schema.
   */
  archiveChatThread(tripId: string): Promise<boolean>

  /**
   * One conversation's messages, oldest first.
   *
   * **Scoped to the thread, never to the trip**, and that is load-bearing since
   * 0024: a trip-scoped read would hand back every archived conversation as
   * well, which shows up as a transcript that will not clear and — worse — as
   * history the model is shown from a conversation the travellers finished with.
   */
  listChatMessages(threadId: string): Promise<ChatMessage[]>
  createChatMessage(input: ChatMessageInput): Promise<ChatMessage>

  /** Append one priced row to the ledger. */
  recordAiUsage(input: AiUsageInput): Promise<AiUsageRow>
  /**
   * What this account has spent since `sinceIso`, in cents. The pre-flight check
   * on every turn.
   *
   * Deliberately not `sumAiUsageForTrip`: the cap is per account (a person with
   * three trips has one budget), and offering a per-trip sum would invite a
   * per-trip cap that multiplies the bill by however many trips somebody makes.
   */
  sumAiUsageCents(userId: string, sinceIso: string): Promise<number>
  /** The same sum across every account — the global kill switch. */
  sumAllAiUsageCents(sinceIso: string): Promise<number>
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
