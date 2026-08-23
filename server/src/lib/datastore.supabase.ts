// Supabase implementation of the DataStore interface (DATA_BACKEND=supabase).
// Same contract as datastore.memory.ts — swapping backends changes no feature
// code. Column names already match the entity field names (snake_case).
import { randomUUID } from 'node:crypto'
import type {
  Category,
  DataStore,
  Profile,
  TripInvite,
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
import { CATEGORIES, normalizeTraveller } from './datastore.js'
import { normalizeFlight } from './flight.js'
import { DEFAULT_HOME_CURRENCIES, DEFAULT_LOCAL_CURRENCY, normalizeCurrency } from './currencies.js'
import { FILES_BUCKET, getSupabase } from './supabase.js'

const SIGNED_URL_TTL = 300 // seconds

// zones.trip_id (migration 0013). Every zone belongs to exactly one trip, which
// is what lets the trip-scoped queries below filter in SQL rather than in JS:
// a place, tip or file is in the trip when its zone is.
const ZONE_COLS = 'id,trip_id,name,name_ja,summary,image_url,lat,lng'

/** The trip's place ids — how tips and files hanging off a place are scoped. */
const placeIdsFor = async (
  db: ReturnType<typeof getSupabase>,
  zoneIds: string[]
): Promise<string[]> => {
  if (!zoneIds.length) return []
  const { data, error } = await db.from('places').select('id').in('zone_id', zoneIds)
  if (error) throw new Error(error.message)
  return ((data as { id: string }[]) ?? []).map((p) => p.id)
}

/** Sub-select of the trip's zone ids, used to scope places in one round-trip. */
const zoneIdsFor = async (
  db: ReturnType<typeof getSupabase>,
  tripId: string
): Promise<string[]> => {
  const { data, error } = await db.from('zones').select('id').eq('trip_id', tripId)
  if (error) throw new Error(error.message)
  return ((data as { id: string }[]) ?? []).map((z) => z.id)
}

// profiles (migration 0010). Reads degrade to "no profile" when the table
// isn't there yet, matching how the column-level fallbacks below let an old
// deploy run against a not-yet-migrated database. Writes are deliberately not
// forgiving — a failed upsert is swallowed by the caller (lib/identity.ts),
// which is where "profile sync must never fail a request" is decided.
const PROFILE_COLS = 'id,email,display_name,avatar_url'

// trip_members (migration 0012).
const MEMBER_COLS =
  'trip_id,user_id,role,can_see_stays,can_see_flight,can_see_documents,can_see_shopping'

// trip_invites (migration 0014). token_hash is never selected: the accept flow
// looks up *by* hash, and nothing else has a reason to read it back.
const INVITE_COLS =
  'id,trip_id,email,role,can_see_stays,can_see_flight,can_see_documents,can_see_shopping,invited_by,expires_at,accepted_at,accepted_by,revoked_at,declined_at,created_at'

function isMissingProfilesTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || /relation .*profiles.* does not exist/i.test(error.message ?? '')
}

// Columns added in migration 0004. If a deployment ships this code before that
// migration is applied, Postgres/PostgREST reports an "undefined column" error;
// we detect it and fall back to the pre-0004 shape so the itinerary still loads
// (highlights are simply inert until the migration runs).
const ITINERARY_BASE_COLS = 'id,trip_id,zone_id,place_id,day,start_time,title,note,position'
const ITINERARY_COLS = `${ITINERARY_BASE_COLS},highlight,icon`

// Columns added in migration 0005 (place map coordinates). Same graceful
// fallback as the itinerary highlight columns: if a deployment ships this code
// before 0005 runs, we retry the query without lat/lng so places still load
// (they just have no pins until the migration is applied).
const PLACE_BASE_COLS = 'id,zone_id,category,name,name_ja,description,address,links,image_url'
const PLACE_COLS = `${PLACE_BASE_COLS},lat,lng`

// Shopping list (migration 0007).
const SHOPPING_COLS =
  'id,trip_id,name,category,note,shop,zone_id,price_yen,url,image_url,bought,position'

// trips.people (migration 0009). Same graceful fallback as the itinerary
// highlight/place coord columns above: an old deploy running against a
// not-yet-migrated database gets trips back with people defaulted to [],
// rather than a hard 500.
const TRIP_BASE_COLS = 'id,name,start_date,end_date,description'
// country arrives in 0015, flight in 0017, the start time in 0020; `people` in
// 0009. All of them degrade the same way.
const TRIP_COLS = `${TRIP_BASE_COLS},people,country,flight,local_currency,home_currencies,start_time,start_tz`

function isMissingPeopleColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === '42703' || error.code === 'PGRST204' || /\bpeople\b/i.test(error.message ?? '')
  )
}

/** A pre-0019 exchange_rates row, read through the shape the app uses now. */
function usdIlsRates(row: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof row.usd === 'number') out.USD = row.usd
  if (typeof row.ils === 'number') out.ILS = row.ils
  return out
}

/** Keeps only codes we can quote; falls back to the pair the app always had. */
function cleanHomeCurrencies(value: unknown): string[] {
  const codes = Array.isArray(value)
    ? [...new Set(value.map(normalizeCurrency).filter((c): c is string => !!c))]
    : []
  return codes.length ? codes : [...DEFAULT_HOME_CURRENCIES]
}

// Also normalizes legacy rows where people was a plain string array (pre
// name+email support), so an unmigrated production row still renders.
function withPeopleDefault(row: Record<string, unknown>): Trip {
  const people = Array.isArray(row.people) ? row.people.map(normalizeTraveller) : []
  // `country` (0015) and `flight` (0017) default the same way `people` (0009)
  // does, so an old deploy against a not-yet-migrated database still renders a
  // trip. The flight is jsonb, so this is also where its shape is checked.
  return {
    ...row,
    people,
    country: (row.country as string | null) ?? null,
    flight: normalizeFlight(row.flight),
    // 0010/0019. Same story again: a row from before the currency pickers (or
    // a database that hasn't run 0019) still gets a working calculator.
    local_currency: normalizeCurrency(row.local_currency) ?? DEFAULT_LOCAL_CURRENCY,
    home_currencies: cleanHomeCurrencies(row.home_currencies),
    // 0020. Absent until that migration runs, and absent is a valid answer —
    // it simply means the trip has no particular start time.
    start_time: (row.start_time as string | null) ?? null,
    start_tz: (row.start_tz as string | null) ?? null,
  } as unknown as Trip
}

// Tables added in migration 0006 (scheduled reminders + push subscriptions).
const REMINDER_COLS = 'id,trip_id,title,body,url,remind_at,time_zone,sent_at,created_at'
const SUBSCRIPTION_COLS = 'id,user_id,endpoint,p256dh,auth,label,created_at'

/** timestamptz comes back with an offset; normalize so the API always emits UTC. */
function toIsoUtc(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

function rowToReminder(row: Record<string, unknown>): Reminder {
  const r = row as unknown as Reminder
  return {
    ...r,
    remind_at: toIsoUtc(r.remind_at) ?? r.remind_at,
    sent_at: toIsoUtc(r.sent_at),
    created_at: toIsoUtc(r.created_at) ?? r.created_at,
  }
}

function isMissingHighlightColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // 42703 = undefined_column (select); PGRST204 = column not in schema cache (write)
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /\b(highlight|icon)\b/i.test(error.message ?? '')
  )
}

function isMissingCoordColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /\b(lat|lng)\b/i.test(error.message ?? '')
  )
}

/** Ensure the 0004 fields exist on a row that may predate the migration. */
function withHighlightDefaults(row: Record<string, unknown>): ItineraryItem {
  return { highlight: false, icon: null, ...row } as ItineraryItem
}

export function createSupabaseStore(): DataStore {
  const db = getSupabase()

  /** A file is in the trip when it hangs off the trip, or off one of its zones or places. */
  const fileBelongs = async (tripId: string, file: FileAttachment): Promise<boolean> => {
    if (file.trip_id) return file.trip_id === tripId
    const zoneIds = await zoneIdsFor(db, tripId)
    if (file.zone_id) return zoneIds.includes(file.zone_id)
    return !!file.place_id && (await placeIdsFor(db, zoneIds)).includes(file.place_id)
  }

  const fileInTrip = async (tripId: string, fileId: string): Promise<boolean> => {
    const { data } = await db
      .from('files')
      .select('id,trip_id,zone_id,place_id,display_name,storage_path,mime_type,size_bytes')
      .eq('id', fileId)
      .maybeSingle()
    const file = (data as FileAttachment) ?? null
    return !!file && (await fileBelongs(tripId, file))
  }

  /** A tip inherits the trip of its single parent — a zone or a place. */
  const tipInTrip = async (tripId: string, tipId: string): Promise<boolean> => {
    const { data } = await db
      .from('tips')
      .select('id,zone_id,place_id,body')
      .eq('id', tipId)
      .maybeSingle()
    const tip = (data as Tip) ?? null
    if (!tip) return false
    const zoneIds = await zoneIdsFor(db, tripId)
    if (tip.zone_id) return zoneIds.includes(tip.zone_id)
    return !!tip.place_id && (await placeIdsFor(db, zoneIds)).includes(tip.place_id)
  }

  return {
    async ping() {
      const { error } = await db.from('trips').select('id').limit(1)
      if (error) throw new Error(`Supabase unreachable: ${error.message}`)
    },

    async getProfile(userId) {
      const { data, error } = await db
        .from('profiles')
        .select(PROFILE_COLS)
        .eq('id', userId)
        .maybeSingle()
      if (error) {
        if (isMissingProfilesTable(error)) return null
        throw new Error(error.message)
      }
      return (data as Profile | null) ?? null
    },

    async getProfileByEmail(email) {
      const { data, error } = await db
        .from('profiles')
        .select(PROFILE_COLS)
        .ilike('email', email.trim())
        .maybeSingle()
      if (error) {
        if (isMissingProfilesTable(error)) return null
        throw new Error(error.message)
      }
      return (data as Profile | null) ?? null
    },

    async upsertProfile(input) {
      // `ignoreDuplicates: false` = update on conflict. Undefined fields are
      // stripped first so a provider that omits the name doesn't blank one we
      // already stored.
      const row: Record<string, unknown> = { id: input.id, email: input.email }
      if (input.display_name != null) row.display_name = input.display_name
      if (input.avatar_url != null) row.avatar_url = input.avatar_url
      const { data, error } = await db
        .from('profiles')
        .upsert(row, { onConflict: 'id' })
        .select(PROFILE_COLS)
        .single()
      if (error) throw new Error(error.message)
      return data as Profile
    },

    async listTripsForUser(userId) {
      const { data: memberships, error: memberError } = await db
        .from('trip_members')
        .select('trip_id')
        .eq('user_id', userId)
      if (memberError) throw new Error(memberError.message)
      const ids = (memberships ?? []).map((m) => m.trip_id as string)
      // `.in()` with an empty list is a valid query but a pointless round-trip.
      if (!ids.length) return []

      const run = (cols: string) =>
        db.from('trips').select(cols).in('id', ids).order('created_at', { ascending: true })
      let { data, error } = await run(TRIP_COLS)
      if (error && isMissingPeopleColumn(error)) ({ data, error } = await run(TRIP_BASE_COLS))
      if (error) throw new Error(error.message)
      return ((data as unknown as Record<string, unknown>[]) ?? []).map(withPeopleDefault)
    },

    async listTripInvites(tripId) {
      const { data, error } = await db
        .from('trip_invites')
        .select(INVITE_COLS)
        .eq('trip_id', tripId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        // Declined rows are deliberately *not* filtered here: the service
        // labels them, so the inviter sees "declined" rather than an invite
        // that quietly vanished.
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data as unknown as TripInvite[]) ?? []
    },

    async listInvitesForEmail(email) {
      const wanted = email.trim().toLowerCase()
      if (!wanted) return []
      const { data, error } = await db
        .from('trip_invites')
        .select(INVITE_COLS)
        .ilike('email', wanted)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data as unknown as TripInvite[]) ?? []
    },

    async getInviteById(inviteId) {
      const { data, error } = await db
        .from('trip_invites')
        .select(INVITE_COLS)
        .eq('id', inviteId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as unknown as TripInvite | null) ?? null
    },

    async getInviteByTokenHash(tokenHash) {
      const { data, error } = await db
        .from('trip_invites')
        .select(INVITE_COLS)
        .eq('token_hash', tokenHash)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as unknown as TripInvite | null) ?? null
    },

    async getTripInvite(tripId, inviteId) {
      const { data, error } = await db
        .from('trip_invites')
        .select(INVITE_COLS)
        .eq('id', inviteId)
        .eq('trip_id', tripId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as unknown as TripInvite | null) ?? null
    },

    async createTripInvite(input) {
      const row = {
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
      }
      const { data, error } = await db.from('trip_invites').insert(row).select(INVITE_COLS).single()
      if (error) throw new Error(error.message)
      return data as unknown as TripInvite
    },

    async updateTripInvite(inviteId, patch) {
      // Single use, enforced in the WHERE clause rather than by reading first:
      // two racing accepts cannot both stamp the same invite.
      const { data, error } = await db
        .from('trip_invites')
        .update(patch)
        .eq('id', inviteId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .is('declined_at', null)
        .select(INVITE_COLS)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as unknown as TripInvite | null) ?? null
    },

    async listMembershipsForUser(userId) {
      const { data, error } = await db
        .from('trip_members')
        .select(MEMBER_COLS)
        .eq('user_id', userId)
      if (error) throw new Error(error.message)
      return (data as unknown as TripMember[]) ?? []
    },

    async listTripMembers(tripId) {
      const { data, error } = await db
        .from('trip_members')
        .select(MEMBER_COLS)
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data as unknown as TripMember[]) ?? []
    },

    async getTripMember(tripId, userId) {
      const { data, error } = await db
        .from('trip_members')
        .select(MEMBER_COLS)
        .eq('trip_id', tripId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as unknown as TripMember | null) ?? null
    },

    async upsertTripMember(input) {
      const row: Record<string, unknown> = {
        trip_id: input.trip_id,
        user_id: input.user_id,
        role: input.role,
      }
      // Undefined flags are left to the column defaults on insert, and left
      // untouched on update — the owner's visibility choices survive a role change.
      if (input.can_see_stays !== undefined) row.can_see_stays = input.can_see_stays
      if (input.can_see_flight !== undefined) row.can_see_flight = input.can_see_flight
      if (input.can_see_documents !== undefined) row.can_see_documents = input.can_see_documents
      if (input.can_see_shopping !== undefined) row.can_see_shopping = input.can_see_shopping
      const { data, error } = await db
        .from('trip_members')
        .upsert(row, { onConflict: 'trip_id,user_id' })
        .select(MEMBER_COLS)
        .single()
      if (error) throw new Error(error.message)
      return data as unknown as TripMember
    },

    async removeTripMember(tripId, userId) {
      const { data, error } = await db
        .from('trip_members')
        .delete()
        .eq('trip_id', tripId)
        .eq('user_id', userId)
        .select('user_id')
      if (error) throw new Error(error.message)
      return (data ?? []).length > 0
    },

    async getTrip(tripId) {
      const run = (cols: string) => db.from('trips').select(cols).eq('id', tripId).maybeSingle()
      let { data, error } = await run(TRIP_COLS)
      if (error && isMissingPeopleColumn(error)) ({ data, error } = await run(TRIP_BASE_COLS))
      if (error) throw new Error(error.message)
      return data ? withPeopleDefault(data as unknown as Record<string, unknown>) : null
    },

    async createTrip(input: TripInput) {
      const base = {
        id: randomUUID(),
        name: input.name ?? null,
        start_date: input.start_date,
        end_date: input.end_date,
        description: input.description ?? null,
      }
      const row = {
        ...base,
        people: input.people ?? [],
        country: input.country ?? null,
        local_currency: input.local_currency ?? DEFAULT_LOCAL_CURRENCY,
        home_currencies: input.home_currencies ?? [...DEFAULT_HOME_CURRENCIES],
        flight: input.flight ?? null,
        start_time: input.start_time ?? null,
        start_tz: input.start_tz ?? null,
      }
      let { data, error } = await db.from('trips').insert(row).select(TRIP_COLS).single()
      if (error && isMissingPeopleColumn(error))
        ({ data, error } = await db.from('trips').insert(base).select(TRIP_BASE_COLS).single())
      if (error) throw new Error(error.message)
      return withPeopleDefault(data as unknown as Record<string, unknown>)
    },

    async updateTrip(tripId, patch) {
      const fields: Record<string, unknown> = {}
      if (patch.name !== undefined) fields.name = patch.name
      if (patch.country !== undefined) fields.country = patch.country ?? null
      if (patch.start_date !== undefined) fields.start_date = patch.start_date
      if (patch.end_date !== undefined) fields.end_date = patch.end_date
      if (patch.description !== undefined) fields.description = patch.description ?? null
      if (patch.people !== undefined) fields.people = patch.people ?? []
      if (patch.local_currency !== undefined) fields.local_currency = patch.local_currency
      if (patch.home_currencies !== undefined) fields.home_currencies = patch.home_currencies
      if (patch.flight !== undefined) fields.flight = patch.flight ?? null
      if (patch.start_time !== undefined) fields.start_time = patch.start_time ?? null
      if (patch.start_tz !== undefined) fields.start_tz = patch.start_tz ?? null
      const run = (f: Record<string, unknown>, cols: string) =>
        db.from('trips').update(f).eq('id', tripId).select(cols).maybeSingle()
      let { data, error } = await run(fields, TRIP_COLS)
      if (error && isMissingPeopleColumn(error)) {
        const rest = { ...fields }
        delete rest.people
        delete rest.country
        delete rest.local_currency
        delete rest.home_currencies
        delete rest.flight
        delete rest.start_time
        delete rest.start_tz
        if (Object.keys(rest).length === 0) {
          throw new Error(
            'Cannot save travellers: the trips.people column is missing — run supabase/migrations/0009_multi_trip.sql'
          )
        }
        ;({ data, error } = await run(rest, TRIP_BASE_COLS))
      }
      if (error) throw new Error(error.message)
      return data ? withPeopleDefault(data as unknown as Record<string, unknown>) : null
    },

    async deleteTrip(tripId) {
      // journey_steps/itinerary_items/shopping_items/reminders/files all
      // reference trip_id with `on delete cascade` (0001/0002/0006/0007).
      const { data } = await db.from('trips').delete().eq('id', tripId).select('id')
      return (data?.length ?? 0) > 0
    },

    async listSteps(tripId) {
      const { data } = await db
        .from('journey_steps')
        .select('id,trip_id,zone_id,position,start_date,end_date')
        .eq('trip_id', tripId)
        .order('start_date', { ascending: true })
        .order('position', { ascending: true })
      return (data as JourneyStep[]) ?? []
    },

    async getStep(tripId, stepId) {
      const { data } = await db
        .from('journey_steps')
        .select('id,trip_id,zone_id,position,start_date,end_date')
        .eq('id', stepId)
        .eq('trip_id', tripId)
        .maybeSingle()
      return (data as JourneyStep) ?? null
    },

    async createStep(input: JourneyStepInput) {
      const row = {
        id: randomUUID(),
        trip_id: input.trip_id,
        zone_id: input.zone_id,
        position: input.position ?? 0,
        start_date: input.start_date,
        end_date: input.end_date,
      }
      const { data, error } = await db.from('journey_steps').insert(row).select().single()
      if (error) throw new Error(error.message)
      return data as JourneyStep
    },

    async updateStep(tripId, stepId, patch) {
      const fields: Record<string, unknown> = {}
      if (patch.zone_id !== undefined) fields.zone_id = patch.zone_id
      if (patch.position !== undefined) fields.position = patch.position
      if (patch.start_date !== undefined) fields.start_date = patch.start_date
      if (patch.end_date !== undefined) fields.end_date = patch.end_date
      const { data, error } = await db
        .from('journey_steps')
        .update(fields)
        .eq('id', stepId)
        .eq('trip_id', tripId)
        .select()
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as JourneyStep) ?? null
    },

    async deleteStep(tripId, stepId) {
      const { data } = await db
        .from('journey_steps')
        .delete()
        .eq('id', stepId)
        .eq('trip_id', tripId)
        .select('id')
      return (data?.length ?? 0) > 0
    },

    async listZones(tripId) {
      const { data } = await db
        .from('zones')
        .select(ZONE_COLS)
        .eq('trip_id', tripId)
        .order('name', { ascending: true })
      return (data as Zone[]) ?? []
    },

    async getZone(tripId, zoneId) {
      const { data } = await db
        .from('zones')
        .select(ZONE_COLS)
        .eq('id', zoneId)
        .eq('trip_id', tripId)
        .maybeSingle()
      return (data as Zone) ?? null
    },

    async createZone(input: ZoneInput) {
      const row = {
        id: randomUUID(),
        trip_id: input.trip_id,
        name: input.name,
        name_ja: input.name_ja ?? null,
        summary: input.summary ?? null,
        image_url: input.image_url ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
      }
      const { data, error } = await db.from('zones').insert(row).select().single()
      if (error) throw new Error(error.message)
      return data as Zone
    },

    async updateZone(tripId, zoneId, patch) {
      const fields: Record<string, unknown> = {}
      if (patch.image_url !== undefined) fields.image_url = patch.image_url ?? null
      // The trip_id is in the WHERE clause, not checked first: a zone belonging
      // to another trip matches no row and comes back null, with no second
      // round-trip and no window between the check and the write.
      const { data, error } = await db
        .from('zones')
        .update(fields)
        .eq('id', zoneId)
        .eq('trip_id', tripId)
        .select(ZONE_COLS)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as unknown as Zone | null) ?? null
    },

    async countPlacesByCategory(tripId, zoneId) {
      const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
      if (!(await zoneIdsFor(db, tripId)).includes(zoneId)) return counts
      const { data } = await db.from('places').select('category').eq('zone_id', zoneId)
      for (const row of (data as { category: Category }[]) ?? []) counts[row.category]++
      return counts
    },

    async listPlaces(tripId, zoneId, category) {
      if (!(await zoneIdsFor(db, tripId)).includes(zoneId)) return []
      const run = (cols: string) =>
        db
          .from('places')
          .select(cols)
          .eq('zone_id', zoneId)
          .eq('category', category)
          .order('created_at', { ascending: true })
      let { data, error } = await run(PLACE_COLS)
      if (error && isMissingCoordColumn(error)) ({ data, error } = await run(PLACE_BASE_COLS))
      if (error) throw new Error(error.message)
      return (data as unknown as Place[]) ?? []
    },

    async listPlacesInZone(tripId, zoneId) {
      if (!(await zoneIdsFor(db, tripId)).includes(zoneId)) return []
      const run = (cols: string) =>
        db
          .from('places')
          .select(cols)
          .eq('zone_id', zoneId)
          .order('created_at', { ascending: true })
      let { data, error } = await run(PLACE_COLS)
      if (error && isMissingCoordColumn(error)) ({ data, error } = await run(PLACE_BASE_COLS))
      if (error) throw new Error(error.message)
      return (data as unknown as Place[]) ?? []
    },

    async getPlace(tripId, placeId) {
      const zoneIds = await zoneIdsFor(db, tripId)
      if (!zoneIds.length) return null
      const run = (cols: string) =>
        db.from('places').select(cols).eq('id', placeId).in('zone_id', zoneIds).maybeSingle()
      let { data, error } = await run(PLACE_COLS)
      if (error && isMissingCoordColumn(error)) ({ data, error } = await run(PLACE_BASE_COLS))
      if (error) throw new Error(error.message)
      return (data as unknown as Place) ?? null
    },

    async listPlaceIdsByCategory(tripId, category) {
      const zoneIds = await zoneIdsFor(db, tripId)
      if (!zoneIds.length) return []
      const { data, error } = await db
        .from('places')
        .select('id')
        .eq('category', category)
        .in('zone_id', zoneIds)
      if (error) throw new Error(error.message)
      return ((data as { id: string }[]) ?? []).map((row) => row.id)
    },

    async createPlace(tripId, input: PlaceInput) {
      if (!(await zoneIdsFor(db, tripId)).includes(input.zone_id)) {
        throw new Error('zone does not belong to this trip')
      }
      const base = {
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
      const row = { ...base, lat: input.lat ?? null, lng: input.lng ?? null }
      let { data, error } = await db.from('places').insert(row).select().single()
      if (error && isMissingCoordColumn(error))
        ({ data, error } = await db.from('places').insert(base).select().single())
      if (error) throw new Error(error.message)
      return data as Place
    },

    async updatePlace(tripId, placeId, patch) {
      const zoneIds = await zoneIdsFor(db, tripId)
      if (!zoneIds.length) return null
      // Both ends have to be in this trip, or a place could be moved into
      // someone else's city.
      if (patch.zone_id !== undefined && !zoneIds.includes(patch.zone_id)) return null
      const fields: Record<string, unknown> = {}
      if (patch.zone_id !== undefined) fields.zone_id = patch.zone_id
      if (patch.category !== undefined) fields.category = patch.category
      if (patch.name !== undefined) fields.name = patch.name
      if (patch.name_ja !== undefined) fields.name_ja = patch.name_ja ?? null
      if (patch.description !== undefined) fields.description = patch.description ?? null
      if (patch.address !== undefined) fields.address = patch.address ?? null
      if (patch.links !== undefined) fields.links = patch.links ?? []
      if (patch.image_url !== undefined) fields.image_url = patch.image_url ?? null
      if (patch.lat !== undefined) fields.lat = patch.lat ?? null
      if (patch.lng !== undefined) fields.lng = patch.lng ?? null
      const run = (f: Record<string, unknown>) =>
        db.from('places').update(f).eq('id', placeId).in('zone_id', zoneIds).select().maybeSingle()
      let { data, error } = await run(fields)
      if (error && isMissingCoordColumn(error)) {
        const rest = { ...fields }
        delete rest.lat
        delete rest.lng
        // If lat/lng were the only fields being patched, there's nothing left
        // to update — migration 0005 (places.lat/lng) hasn't been applied
        // yet. Fail loudly instead of issuing an empty UPDATE, which matches
        // no row and would otherwise surface as a misleading "place not
        // found" (the empty patch, not the id, is the actual problem).
        if (Object.keys(rest).length === 0) {
          throw new Error(
            'Cannot save map coordinates: the places.lat/lng columns are missing — run supabase/migrations/0005_place_coords.sql'
          )
        }
        ;({ data, error } = await run(rest))
      }
      if (error) throw new Error(error.message)
      return (data as Place) ?? null
    },

    async deletePlace(tripId, placeId) {
      const zoneIds = await zoneIdsFor(db, tripId)
      if (!zoneIds.length) return false
      // tips cascade via the DB foreign key
      const { data } = await db
        .from('places')
        .delete()
        .eq('id', placeId)
        .in('zone_id', zoneIds)
        .select('id')
      return (data?.length ?? 0) > 0
    },

    async listItinerary(tripId) {
      const run = (cols: string) =>
        db
          .from('itinerary_items')
          .select(cols)
          .eq('trip_id', tripId)
          .order('day', { ascending: true })
          .order('start_time', { ascending: true, nullsFirst: false })
          .order('position', { ascending: true })
      let { data, error } = await run(ITINERARY_COLS)
      if (error && isMissingHighlightColumn(error))
        ({ data, error } = await run(ITINERARY_BASE_COLS))
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => withHighlightDefaults(r as unknown as Record<string, unknown>))
    },

    async getItineraryItem(tripId, itemId) {
      const run = (cols: string) =>
        db.from('itinerary_items').select(cols).eq('id', itemId).eq('trip_id', tripId).maybeSingle()
      let { data, error } = await run(ITINERARY_COLS)
      if (error && isMissingHighlightColumn(error))
        ({ data, error } = await run(ITINERARY_BASE_COLS))
      if (error) throw new Error(error.message)
      return data ? withHighlightDefaults(data as unknown as Record<string, unknown>) : null
    },

    async createItineraryItem(input: ItineraryItemInput) {
      const base = {
        id: randomUUID(),
        trip_id: input.trip_id,
        zone_id: input.zone_id ?? null,
        place_id: input.place_id ?? null,
        day: input.day,
        start_time: input.start_time ?? null,
        title: input.title,
        note: input.note ?? null,
        position: input.position ?? 0,
      }
      const row = { ...base, highlight: input.highlight ?? false, icon: input.icon ?? null }
      let { data, error } = await db.from('itinerary_items').insert(row).select().single()
      if (error && isMissingHighlightColumn(error))
        ({ data, error } = await db.from('itinerary_items').insert(base).select().single())
      if (error) throw new Error(error.message)
      return withHighlightDefaults(data as Record<string, unknown>)
    },

    async updateItineraryItem(tripId, itemId, patch) {
      const fields: Record<string, unknown> = {}
      if (patch.zone_id !== undefined) fields.zone_id = patch.zone_id ?? null
      if (patch.place_id !== undefined) fields.place_id = patch.place_id ?? null
      if (patch.day !== undefined) fields.day = patch.day
      if (patch.start_time !== undefined) fields.start_time = patch.start_time ?? null
      if (patch.title !== undefined) fields.title = patch.title
      if (patch.note !== undefined) fields.note = patch.note ?? null
      if (patch.position !== undefined) fields.position = patch.position ?? 0
      if (patch.highlight !== undefined) fields.highlight = patch.highlight ?? false
      if (patch.icon !== undefined) fields.icon = patch.icon ?? null
      const run = (f: Record<string, unknown>) =>
        db
          .from('itinerary_items')
          .update(f)
          .eq('id', itemId)
          .eq('trip_id', tripId)
          .select()
          .maybeSingle()
      let { data, error } = await run(fields)
      if (error && isMissingHighlightColumn(error)) {
        const rest = { ...fields }
        delete rest.highlight
        delete rest.icon
        // Same "nothing left to update" case as updatePlace above — fail
        // loudly rather than issuing an empty UPDATE that matches no row.
        if (Object.keys(rest).length === 0) {
          throw new Error(
            'Cannot save highlight/icon: the itinerary_items.highlight/icon columns are missing — run supabase/migrations/0004_itinerary_highlights.sql'
          )
        }
        ;({ data, error } = await run(rest))
      }
      if (error) throw new Error(error.message)
      return data ? withHighlightDefaults(data as Record<string, unknown>) : null
    },

    async deleteItineraryItem(tripId, itemId) {
      const { data } = await db
        .from('itinerary_items')
        .delete()
        .eq('id', itemId)
        .eq('trip_id', tripId)
        .select('id')
      return (data?.length ?? 0) > 0
    },

    async listShoppingItems(tripId) {
      // unbought first, then manual position — mirrors the memory store's order
      const { data, error } = await db
        .from('shopping_items')
        .select(SHOPPING_COLS)
        .eq('trip_id', tripId)
        .order('bought', { ascending: true })
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data as unknown as ShoppingItem[]) ?? []
    },

    async createShoppingItem(input: ShoppingItemInput) {
      const row = {
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
      const { data, error } = await db.from('shopping_items').insert(row).select().single()
      if (error) throw new Error(error.message)
      return data as ShoppingItem
    },

    async updateShoppingItem(tripId, itemId, patch) {
      const fields: Record<string, unknown> = {}
      if (patch.name !== undefined) fields.name = patch.name
      if (patch.category !== undefined) fields.category = patch.category ?? 'other'
      if (patch.note !== undefined) fields.note = patch.note ?? null
      if (patch.shop !== undefined) fields.shop = patch.shop ?? null
      if (patch.zone_id !== undefined) fields.zone_id = patch.zone_id ?? null
      if (patch.price_yen !== undefined) fields.price_yen = patch.price_yen ?? null
      if (patch.url !== undefined) fields.url = patch.url ?? null
      if (patch.image_url !== undefined) fields.image_url = patch.image_url ?? null
      if (patch.bought !== undefined) fields.bought = patch.bought ?? false
      if (patch.position !== undefined) fields.position = patch.position ?? 0
      const { data, error } = await db
        .from('shopping_items')
        .update(fields)
        .eq('id', itemId)
        .eq('trip_id', tripId)
        .select()
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as ShoppingItem) ?? null
    },

    async deleteShoppingItem(tripId, itemId) {
      const { data } = await db
        .from('shopping_items')
        .delete()
        .eq('id', itemId)
        .eq('trip_id', tripId)
        .select('id')
      return (data?.length ?? 0) > 0
    },

    async listTips(tripId, parent) {
      const zoneIds = await zoneIdsFor(db, tripId)
      const q = db.from('tips').select('id,zone_id,place_id,body')
      if ('zone_id' in parent) {
        if (!zoneIds.includes(parent.zone_id)) return []
        const { data } = await q.eq('zone_id', parent.zone_id)
        return (data as Tip[]) ?? []
      }
      if (!(await placeIdsFor(db, zoneIds)).includes(parent.place_id)) return []
      const { data } = await q.eq('place_id', parent.place_id)
      return (data as Tip[]) ?? []
    },

    async createTip(tripId, input: TipInput) {
      const zoneIds = await zoneIdsFor(db, tripId)
      const parentInTrip = input.zone_id
        ? zoneIds.includes(input.zone_id)
        : !!input.place_id && (await placeIdsFor(db, zoneIds)).includes(input.place_id)
      if (!parentInTrip) throw new Error('tip parent does not belong to this trip')
      const row = {
        id: randomUUID(),
        zone_id: input.zone_id ?? null,
        place_id: input.place_id ?? null,
        body: input.body,
      }
      const { data, error } = await db.from('tips').insert(row).select().single()
      if (error) throw new Error(error.message)
      return data as Tip
    },

    async updateTip(tripId, tipId, body) {
      if (!(await tipInTrip(tripId, tipId))) return null
      const { data } = await db.from('tips').update({ body }).eq('id', tipId).select().maybeSingle()
      return (data as Tip) ?? null
    },

    async deleteTip(tripId, tipId) {
      if (!(await tipInTrip(tripId, tipId))) return false
      const { data } = await db.from('tips').delete().eq('id', tipId).select('id')
      return (data?.length ?? 0) > 0
    },

    async listFiles(tripId, parent) {
      const q = db
        .from('files')
        .select('id,trip_id,zone_id,place_id,display_name,storage_path,mime_type,size_bytes')
      let res
      if ('trip_id' in parent) res = await q.eq('trip_id', parent.trip_id)
      else if ('zone_id' in parent) res = await q.eq('zone_id', parent.zone_id)
      else res = await q.eq('place_id', parent.place_id)
      const files = (res.data as FileAttachment[]) ?? []
      // The parent filter alone would happily return a zone or place from
      // another trip; this is what makes the trip id load-bearing.
      const belongs = await Promise.all(files.map((f) => fileBelongs(tripId, f)))
      return files.filter((_f, i) => belongs[i])
    },

    async listAllFiles(tripId) {
      const cols = 'id,trip_id,zone_id,place_id,display_name,storage_path,mime_type,size_bytes'
      const { data: steps } = await db.from('journey_steps').select('zone_id').eq('trip_id', tripId)
      const zoneIds = [...new Set(((steps ?? []) as { zone_id: string }[]).map((s) => s.zone_id))]
      let placeIds: string[] = []
      if (zoneIds.length) {
        const { data: places } = await db.from('places').select('id').in('zone_id', zoneIds)
        placeIds = ((places ?? []) as { id: string }[]).map((p) => p.id)
      }
      const [tripFiles, zoneFiles, placeFiles] = await Promise.all([
        db.from('files').select(cols).eq('trip_id', tripId),
        zoneIds.length
          ? db.from('files').select(cols).in('zone_id', zoneIds)
          : Promise.resolve({ data: [] as unknown[] }),
        placeIds.length
          ? db.from('files').select(cols).in('place_id', placeIds)
          : Promise.resolve({ data: [] as unknown[] }),
      ])
      const merged = new Map<string, FileAttachment>()
      for (const row of [
        ...(tripFiles.data ?? []),
        ...(zoneFiles.data ?? []),
        ...(placeFiles.data ?? []),
      ] as FileAttachment[]) {
        merged.set(row.id, row)
      }
      return [...merged.values()]
    },

    async countTripFiles(tripId) {
      const { count } = await db
        .from('files')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', tripId)
      return count ?? 0
    },

    async createFile(input: FileInput, bytes: Buffer) {
      const up = await db.storage
        .from(FILES_BUCKET)
        .upload(input.storage_path, bytes, { contentType: input.mime_type, upsert: false })
      if (up.error) throw new Error(`storage upload failed: ${up.error.message}`)
      const row = {
        id: randomUUID(),
        trip_id: input.trip_id ?? null,
        zone_id: input.zone_id ?? null,
        place_id: input.place_id ?? null,
        display_name: input.display_name,
        storage_path: input.storage_path,
        mime_type: input.mime_type,
        size_bytes: input.size_bytes,
      }
      const { data, error } = await db.from('files').insert(row).select().single()
      if (error) {
        // don't leave an orphan blob if the row insert fails
        await db.storage.from(FILES_BUCKET).remove([input.storage_path])
        throw new Error(error.message)
      }
      return data as FileAttachment
    },

    async deleteFile(tripId, fileId) {
      if (!(await fileInTrip(tripId, fileId))) return false
      const { data: file } = await db
        .from('files')
        .select('storage_path')
        .eq('id', fileId)
        .maybeSingle()
      if (!file) return false
      await db.storage.from(FILES_BUCKET).remove([(file as { storage_path: string }).storage_path])
      const { data } = await db.from('files').delete().eq('id', fileId).select('id')
      return (data?.length ?? 0) > 0
    },

    async getFile(tripId, fileId) {
      const { data } = await db
        .from('files')
        .select('id,trip_id,zone_id,place_id,display_name,storage_path,mime_type,size_bytes')
        .eq('id', fileId)
        .maybeSingle()
      const file = (data as FileAttachment) ?? null
      return file && (await fileBelongs(tripId, file)) ? file : null
    },

    async reparentFilesToTrip(placeId, tripId) {
      await db.from('files').update({ place_id: null, trip_id: tripId }).eq('place_id', placeId)
    },

    async getFileUrl(file): Promise<FileUrlResult> {
      const { data, error } = await db.storage
        .from(FILES_BUCKET)
        .createSignedUrl(file.storage_path, SIGNED_URL_TTL)
      // row exists but the blob is gone → FILE_MISSING (contracts/api.md)
      if (error || !data?.signedUrl) return 'FILE_MISSING'
      return { url: data.signedUrl, expires_in: SIGNED_URL_TTL }
    },

    async getFileBytes(file): Promise<FileBytesResult> {
      const { data, error } = await db.storage.from(FILES_BUCKET).download(file.storage_path)
      if (error || !data) return 'FILE_MISSING'
      return { bytes: Buffer.from(await data.arrayBuffer()), mime_type: file.mime_type }
    },

    async getLatestRates(base: string) {
      const { data } = await db
        .from('exchange_rates')
        .select('base,date,rates,usd,ils')
        .eq('base', base.toUpperCase())
        .maybeSingle()
      const row = data as Record<string, unknown> | null
      if (!row) return null
      const rates =
        row.rates && typeof row.rates === 'object'
          ? (row.rates as Record<string, number>)
          : // A row written before 0019 only has the two hard-coded columns.
            usdIlsRates(row)
      if (!Object.keys(rates).length) return null
      return { base: row.base as string, date: row.date as string, rates }
    },

    async saveRates(rates: ExchangeRates) {
      // usd/ils are written alongside for as long as the pre-0019 columns are
      // there: a rollback to the old code then still finds a usable row.
      await db.from('exchange_rates').upsert(
        {
          base: rates.base,
          date: rates.date,
          rates: rates.rates,
          usd: rates.rates.USD ?? null,
          ils: rates.rates.ILS ?? null,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'base' }
      )
    },

    async listReminders(tripId) {
      const { data } = await db
        .from('reminders')
        .select(REMINDER_COLS)
        .eq('trip_id', tripId)
        .order('remind_at', { ascending: true })
      return ((data as Record<string, unknown>[]) ?? []).map(rowToReminder)
    },

    async getReminder(tripId, reminderId) {
      const { data } = await db
        .from('reminders')
        .select(REMINDER_COLS)
        .eq('id', reminderId)
        .eq('trip_id', tripId)
        .maybeSingle()
      return data ? rowToReminder(data as Record<string, unknown>) : null
    },

    async createReminder(input: ReminderInput) {
      const row = {
        id: randomUUID(),
        trip_id: input.trip_id,
        title: input.title,
        body: input.body ?? null,
        url: input.url ?? null,
        remind_at: input.remind_at,
        time_zone: input.time_zone ?? 'UTC',
        sent_at: null,
      }
      const { data, error } = await db.from('reminders').insert(row).select(REMINDER_COLS).single()
      if (error) throw new Error(error.message)
      return rowToReminder(data as Record<string, unknown>)
    },

    async updateReminder(tripId, reminderId, patch) {
      const fields: Record<string, unknown> = {}
      if (patch.title !== undefined) fields.title = patch.title
      if (patch.body !== undefined) fields.body = patch.body ?? null
      if (patch.url !== undefined) fields.url = patch.url ?? null
      if (patch.remind_at !== undefined) fields.remind_at = patch.remind_at
      if (patch.time_zone !== undefined) fields.time_zone = patch.time_zone ?? 'UTC'
      if (patch.sent_at !== undefined) fields.sent_at = patch.sent_at
      if (!Object.keys(fields).length) {
        const { data } = await db
          .from('reminders')
          .select(REMINDER_COLS)
          .eq('id', reminderId)
          .eq('trip_id', tripId)
          .maybeSingle()
        return data ? rowToReminder(data as Record<string, unknown>) : null
      }
      const { data, error } = await db
        .from('reminders')
        .update(fields)
        .eq('id', reminderId)
        .eq('trip_id', tripId)
        .select(REMINDER_COLS)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? rowToReminder(data as Record<string, unknown>) : null
    },

    async deleteReminder(tripId, reminderId) {
      const { data } = await db
        .from('reminders')
        .delete()
        .eq('id', reminderId)
        .eq('trip_id', tripId)
        .select('id')
      return (data?.length ?? 0) > 0
    },

    async claimDueReminders(nowIso) {
      // One statement: only rows still unsent flip to sent, and only those come
      // back — so two overlapping dispatch runs can't both claim a reminder.
      const { data, error } = await db
        .from('reminders')
        .update({ sent_at: nowIso })
        .lte('remind_at', nowIso)
        .is('sent_at', null)
        .select(REMINDER_COLS)
      if (error) throw new Error(error.message)
      return ((data as Record<string, unknown>[]) ?? []).map(rowToReminder)
    },

    async listPushSubscriptionsForUsers(userIds) {
      // `.in()` on an empty array is a valid query that matches nothing, but
      // short-circuiting says so out loud — this must never widen to "all".
      if (!userIds.length) return []
      const { data } = await db
        .from('push_subscriptions')
        .select(SUBSCRIPTION_COLS)
        .in('user_id', [...userIds])
        .order('created_at', { ascending: true })
      return (data as PushSubscriptionRecord[]) ?? []
    },

    async savePushSubscription(input: PushSubscriptionInput) {
      const row = {
        id: randomUUID(),
        user_id: input.user_id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        label: input.label ?? null,
      }
      const { data, error } = await db
        .from('push_subscriptions')
        .upsert(row, { onConflict: 'endpoint' })
        .select(SUBSCRIPTION_COLS)
        .single()
      if (error) throw new Error(error.message)
      return data as PushSubscriptionRecord
    },

    async deletePushSubscription(userId, endpoint) {
      const { data } = await db
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId)
        .eq('endpoint', endpoint)
        .select('id')
      return (data?.length ?? 0) > 0
    },

    async search(tripId, query) {
      // strip chars that would break PostgREST's or() filter grammar
      const term = query.replace(/[%,()]/g, ' ').trim()
      if (!term) return { places: [], zones: [], tips: [] }
      const like = `%${term}%`

      // Scope first, then match. Searching the whole catalog and filtering
      // afterwards is what leaked other trips' notes before phase 3a-ii.
      const zoneIds = await zoneIdsFor(db, tripId)
      if (!zoneIds.length) return { places: [], zones: [], tips: [] }
      const placeIds = await placeIdsFor(db, zoneIds)

      const placeFilter = `name.ilike.${like},name_ja.ilike.${like},description.ilike.${like},address.ilike.${like}`
      const searchPlaces = async () => {
        const run = (cols: string) =>
          db.from('places').select(cols).in('zone_id', zoneIds).or(placeFilter)
        let { data, error } = await run(PLACE_COLS)
        if (error && isMissingCoordColumn(error)) ({ data, error } = await run(PLACE_BASE_COLS))
        return (data as unknown as Place[]) ?? []
      }
      // A tip belongs to this trip through whichever single parent it has.
      const tipScope = placeIds.length
        ? `zone_id.in.(${zoneIds.join(',')}),place_id.in.(${placeIds.join(',')})`
        : `zone_id.in.(${zoneIds.join(',')})`
      const [places, zones, tips] = await Promise.all([
        searchPlaces(),
        db
          .from('zones')
          .select(ZONE_COLS)
          .eq('trip_id', tripId)
          .or(`name.ilike.${like},name_ja.ilike.${like},summary.ilike.${like}`),
        db.from('tips').select('id,zone_id,place_id,body').ilike('body', like).or(tipScope),
      ])
      return {
        places,
        zones: (zones.data as Zone[]) ?? [],
        tips: (tips.data as Tip[]) ?? [],
      }
    },
  }
}
