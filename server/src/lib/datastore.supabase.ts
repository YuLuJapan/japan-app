// Supabase implementation of the DataStore interface (DATA_BACKEND=supabase).
// Same contract as datastore.memory.ts — swapping backends changes no feature
// code. Column names already match the entity field names (snake_case).
import { randomUUID } from 'node:crypto'
import type {
  AiUsageInput,
  AiUsageRow,
  Category,
  ChatMessage,
  ChatMessageInput,
  ChatThread,
  DataStore,
  Profile,
  TripInvite,
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
import { CATEGORIES, normalizeTraveller } from './datastore.js'
import { normalizeFlight } from './flight.js'
import { DEFAULT_HOME_CURRENCIES, DEFAULT_LOCAL_CURRENCY, normalizeCurrency } from './currencies.js'
import { FILES_BUCKET, getSupabase } from './supabase.js'

const SIGNED_URL_TTL = 300 // seconds

// zones.trip_id (migration 0013). Every zone belongs to exactly one trip, which
// is what lets the trip-scoped queries below filter in SQL rather than in JS:
// a place, tip or file is in the trip when its zone is.
const ZONE_COLS = 'id,trip_id,name,name_ja,summary,image_url,lat,lng'

/** The trip's activity ids — how tips and files hanging off one are scoped. */
const activityIdsFor = async (
  db: ReturnType<typeof getSupabase>,
  tripId: string
): Promise<string[]> => {
  const { data, error } = await db.from('activities').select('id').eq('trip_id', tripId)
  if (error) throw new Error(error.message)
  return ((data as { id: string }[]) ?? []).map((a) => a.id)
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
// accepted_terms_* arrive in 0021 and degrade like every other late column:
// absent reads as "never accepted", which asks again rather than 500ing.
const PROFILE_COLS = 'id,email,display_name,avatar_url,accepted_terms_at,accepted_terms_version'
const PROFILE_BASE_COLS = 'id,email,display_name,avatar_url'

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

// Columns added after the itinerary table existed — `highlight`/`icon` (0004)
// and `category` (0022). If a deployment ships this code before one of those
// migrations is applied, Postgres/PostgREST reports an "undefined column"

// Columns added in migration 0005 (place map coordinates). Same graceful
// fallback as the itinerary highlight columns: if a deployment ships this code
// before 0005 runs, we retry the query without lat/lng so places still load
// (they just have no pins until the migration is applied).
// Activities (migration 0025). One table, so one column list: unlike the
// pre-010 places/itinerary reads there is no tier to fall back to — if 0025
// has not been applied the table itself is absent, which PostgREST reports
// plainly rather than as a missing column.
export const ACTIVITY_COLS =
  'id,trip_id,zone_id,category,name,name_ja,description,address,links,image_url,lat,lng,' +
  'day,start_time,position,highlight,icon'

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

/** Postgres/PostgREST for "that column isn't there" — a migration not yet run. */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204'
}

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
const CHAT_THREAD_COLS = 'id,trip_id,turn_started_at,archived_at,created_at'
const CHAT_MESSAGE_COLS = 'id,thread_id,trip_id,user_id,role,content,created_at'
const AI_USAGE_COLS =
  'id,user_id,trip_id,capability,vendor,model,unit,quantity,cost_cents,created_at'

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

function rowToChatThread(row: Record<string, unknown>): ChatThread {
  const t = row as unknown as ChatThread
  return {
    ...t,
    turn_started_at: toIsoUtc(t.turn_started_at),
    archived_at: toIsoUtc(t.archived_at),
    created_at: toIsoUtc(t.created_at) ?? t.created_at,
  }
}

function rowToChatMessage(row: Record<string, unknown>): ChatMessage {
  const m = row as unknown as ChatMessage
  return { ...m, created_at: toIsoUtc(m.created_at) ?? m.created_at }
}

function rowToAiUsage(row: Record<string, unknown>): AiUsageRow {
  const u = row as unknown as AiUsageRow
  return {
    ...u,
    // numeric(12,4) arrives as a string from PostgREST — summing these as
    // strings would concatenate rather than add, and the cap would never trip.
    cost_cents: Number(u.cost_cents),
    created_at: toIsoUtc(u.created_at) ?? u.created_at,
  }
}

export function createSupabaseStore(): DataStore {
  const db = getSupabase()

  /**
   * Add up `cost_cents` over a window of the ledger.
   *
   * Summed here rather than by a Postgres function, deliberately. The row count
   * is bounded by the very cap this feeds — an account cannot record more spend
   * than the cap before it is blocked — so "fetch the month and add it up" stays
   * small by construction, and the alternative would be two more schema objects
   * to apply to the live project plus a second, untested implementation of the
   * cap that the memory store could silently drift from.
   *
   * **It pages, and that is not defensive habit.** PostgREST caps a response at
   * `db-max-rows` when one is configured, and a truncated page here would not
   * fail — it would return a number that is too small, so the cap would never
   * trip and the only symptom would be the bill. Reading until a short page
   * arrives is what makes the total independent of that setting.
   */
  async function sumUsage(sinceIso: string, userId?: string): Promise<number> {
    const PAGE = 1000
    let total = 0
    for (let from = 0; ; from += PAGE) {
      const base = db.from('ai_usage').select('cost_cents').gte('created_at', sinceIso)
      const scoped = userId ? base.eq('user_id', userId) : base
      const { data, error } = await scoped.range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      const rows = (data as { cost_cents: number | string }[]) ?? []
      // numeric(12,4) arrives as a string from PostgREST; `+` on strings would
      // concatenate, and the cap would compare a very long string to a number.
      for (const row of rows) total += Number(row.cost_cents)
      if (rows.length < PAGE) return total
    }
  }

  /** A file is in the trip when it hangs off the trip, a zone of it, or an activity in it. */
  const fileBelongs = async (tripId: string, file: FileAttachment): Promise<boolean> => {
    if (file.trip_id) return file.trip_id === tripId
    if (file.zone_id) return (await zoneIdsFor(db, tripId)).includes(file.zone_id)
    return !!file.activity_id && (await activityIdsFor(db, tripId)).includes(file.activity_id)
  }

  const fileInTrip = async (tripId: string, fileId: string): Promise<boolean> => {
    const { data } = await db
      .from('files')
      .select('id,trip_id,zone_id,activity_id,display_name,storage_path,mime_type,size_bytes')
      .eq('id', fileId)
      .maybeSingle()
    const file = (data as FileAttachment) ?? null
    return !!file && (await fileBelongs(tripId, file))
  }

  /** A tip inherits the trip of its single parent — a zone or an activity. */
  const tipInTrip = async (tripId: string, tipId: string): Promise<boolean> => {
    const { data } = await db
      .from('tips')
      .select('id,zone_id,activity_id,body')
      .eq('id', tipId)
      .maybeSingle()
    const tip = (data as Tip) ?? null
    if (!tip) return false
    if (tip.zone_id) return (await zoneIdsFor(db, tripId)).includes(tip.zone_id)
    return !!tip.activity_id && (await activityIdsFor(db, tripId)).includes(tip.activity_id)
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
      let { data, error } = await db
        .from('profiles')
        .upsert(row, { onConflict: 'id' })
        .select(PROFILE_COLS)
        .single()
      if (error && isMissingColumn(error))
        ({ data, error } = await db
          .from('profiles')
          .upsert(row, { onConflict: 'id' })
          .select(PROFILE_BASE_COLS)
          .single())
      if (error) throw new Error(error.message)
      return data as Profile
    },

    async acceptTerms(userId, version, at) {
      const { data, error } = await db
        .from('profiles')
        .update({ accepted_terms_at: at, accepted_terms_version: version })
        .eq('id', userId)
        .select(PROFILE_COLS)
        .maybeSingle()
      // A missing column here must be loud: silently "accepting" into nowhere
      // would leave the app asking again on every single visit.
      if (error) throw new Error(error.message)
      return (data as unknown as Profile | null) ?? null
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

    async countSavedByCategory(tripId, zoneId) {
      const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
      if (!(await zoneIdsFor(db, tripId)).includes(zoneId)) return counts
      // Saved only — Explore means "not yet on a day" (FR-011).
      const { data, error } = await db
        .from('activities')
        .select('category')
        .eq('trip_id', tripId)
        .eq('zone_id', zoneId)
        .is('day', null)
      if (error) throw new Error(error.message)
      for (const row of (data as { category: Category | null }[]) ?? []) {
        counts[row.category ?? 'other']++
      }
      return counts
    },

    /**
     * Every activity on the trip, in the order the screens read it: scheduled
     * first in day order, then the saved ones in Explore order.
     *
     * PostgREST sorts nulls last by default on ascending order, which is
     * exactly the split wanted — `day` null sinks below every dated row — so
     * one query answers both halves. `server/tests/ordering.test.ts` pins this
     * against the memory store's comparators.
     */
    async listActivities(tripId) {
      const { data, error } = await db
        .from('activities')
        .select(ACTIVITY_COLS)
        .eq('trip_id', tripId)
        .order('day', { ascending: true, nullsFirst: false })
        .order('start_time', { ascending: true, nullsFirst: false })
        .order('category', { ascending: true, nullsFirst: false })
        .order('position', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw new Error(error.message)
      return (data as unknown as Activity[]) ?? []
    },

    async getActivity(tripId, activityId) {
      const { data, error } = await db
        .from('activities')
        .select(ACTIVITY_COLS)
        .eq('id', activityId)
        .eq('trip_id', tripId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as unknown as Activity) ?? null
    },

    async listActivityIdsByCategory(tripId, category) {
      const { data, error } = await db
        .from('activities')
        .select('id')
        .eq('trip_id', tripId)
        .eq('category', category)
      if (error) throw new Error(error.message)
      return ((data as { id: string }[]) ?? []).map((row) => row.id)
    },

    async createActivity(input: ActivityInput) {
      if (input.zone_id != null && !(await zoneIdsFor(db, input.trip_id)).includes(input.zone_id)) {
        throw new Error('zone does not belong to this trip')
      }
      const row = {
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
      const { data, error } = await db.from('activities').insert(row).select(ACTIVITY_COLS).single()
      if (error) throw new Error(error.message)
      return data as unknown as Activity
    },

    async updateActivity(tripId, activityId, patch) {
      // Both ends have to be in this trip, or an activity could be moved into
      // someone else's city.
      if (patch.zone_id != null && !(await zoneIdsFor(db, tripId)).includes(patch.zone_id)) {
        return null
      }
      const fields: Record<string, unknown> = {}
      if (patch.zone_id !== undefined) fields.zone_id = patch.zone_id ?? null
      if (patch.category !== undefined) fields.category = patch.category ?? null
      if (patch.name !== undefined) fields.name = patch.name
      if (patch.name_ja !== undefined) fields.name_ja = patch.name_ja ?? null
      if (patch.description !== undefined) fields.description = patch.description ?? null
      if (patch.address !== undefined) fields.address = patch.address ?? null
      if (patch.links !== undefined) fields.links = patch.links ?? []
      if (patch.image_url !== undefined) fields.image_url = patch.image_url ?? null
      if (patch.lat !== undefined) fields.lat = patch.lat ?? null
      if (patch.lng !== undefined) fields.lng = patch.lng ?? null
      // Setting or clearing the date moves the row between the day plan and
      // Explore — the one write that changes which list it is in.
      if (patch.day !== undefined) fields.day = patch.day ?? null
      if (patch.start_time !== undefined) fields.start_time = patch.start_time ?? null
      if (patch.position !== undefined) fields.position = patch.position ?? 0
      if (patch.highlight !== undefined) fields.highlight = patch.highlight ?? false
      if (patch.icon !== undefined) fields.icon = patch.icon ?? null
      const { data, error } = await db
        .from('activities')
        .update(fields)
        .eq('id', activityId)
        .eq('trip_id', tripId)
        .select(ACTIVITY_COLS)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as unknown as Activity) ?? null
    },

    async deleteActivity(tripId, activityId) {
      // tips cascade via the DB foreign key
      const { data } = await db
        .from('activities')
        .delete()
        .eq('id', activityId)
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
      const q = db.from('tips').select('id,zone_id,activity_id,body')
      if ('zone_id' in parent) {
        if (!zoneIds.includes(parent.zone_id)) return []
        const { data } = await q.eq('zone_id', parent.zone_id)
        return (data as Tip[]) ?? []
      }
      if (!(await activityIdsFor(db, tripId)).includes(parent.activity_id)) return []
      const { data } = await q.eq('activity_id', parent.activity_id)
      return (data as Tip[]) ?? []
    },

    // Both parents in one query pair — the export needs all of a trip's tips,
    // and asking per parent is ~50 round trips for a real trip (research R5).
    async listAllTips(tripId) {
      const zoneIds = await zoneIdsFor(db, tripId)
      const activityIds = await activityIdsFor(db, tripId)
      const cols = 'id,zone_id,activity_id,body'
      const [zoneTips, activityTips] = await Promise.all([
        zoneIds.length
          ? db.from('tips').select(cols).in('zone_id', zoneIds)
          : Promise.resolve({ data: [] as unknown[], error: null }),
        activityIds.length
          ? db.from('tips').select(cols).in('activity_id', activityIds)
          : Promise.resolve({ data: [] as unknown[], error: null }),
      ])
      if (zoneTips.error) throw new Error(zoneTips.error.message)
      if (activityTips.error) throw new Error(activityTips.error.message)
      return [...((zoneTips.data as Tip[]) ?? []), ...((activityTips.data as Tip[]) ?? [])]
    },

    async createTip(tripId, input: TipInput) {
      const zoneIds = await zoneIdsFor(db, tripId)
      const parentInTrip = input.zone_id
        ? zoneIds.includes(input.zone_id)
        : !!input.activity_id && (await activityIdsFor(db, tripId)).includes(input.activity_id)
      if (!parentInTrip) throw new Error('tip parent does not belong to this trip')
      const row = {
        id: randomUUID(),
        zone_id: input.zone_id ?? null,
        activity_id: input.activity_id ?? null,
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
        .select('id,trip_id,zone_id,activity_id,display_name,storage_path,mime_type,size_bytes')
      let res
      if ('trip_id' in parent) res = await q.eq('trip_id', parent.trip_id)
      else if ('zone_id' in parent) res = await q.eq('zone_id', parent.zone_id)
      else res = await q.eq('activity_id', parent.activity_id)
      const files = (res.data as FileAttachment[]) ?? []
      // The parent filter alone would happily return a zone or activity from
      // another trip; this is what makes the trip id load-bearing.
      const belongs = await Promise.all(files.map((f) => fileBelongs(tripId, f)))
      return files.filter((_f, i) => belongs[i])
    },

    async listAllFiles(tripId) {
      const cols = 'id,trip_id,zone_id,activity_id,display_name,storage_path,mime_type,size_bytes'
      const { data: steps } = await db.from('journey_steps').select('zone_id').eq('trip_id', tripId)
      const zoneIds = [...new Set(((steps ?? []) as { zone_id: string }[]).map((s) => s.zone_id))]
      const activityIds = await activityIdsFor(db, tripId)
      const [tripFiles, zoneFiles, activityFiles] = await Promise.all([
        db.from('files').select(cols).eq('trip_id', tripId),
        zoneIds.length
          ? db.from('files').select(cols).in('zone_id', zoneIds)
          : Promise.resolve({ data: [] as unknown[] }),
        activityIds.length
          ? db.from('files').select(cols).in('activity_id', activityIds)
          : Promise.resolve({ data: [] as unknown[] }),
      ])
      const merged = new Map<string, FileAttachment>()
      for (const row of [
        ...(tripFiles.data ?? []),
        ...(zoneFiles.data ?? []),
        ...(activityFiles.data ?? []),
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
        activity_id: input.activity_id ?? null,
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

    async updateFile(tripId, fileId, patch) {
      // The trip check first, and by the same route as every other file read:
      // an id alone is not evidence the file is this trip's.
      if (!(await fileInTrip(tripId, fileId))) return null
      const { data } = await db
        .from('files')
        .update({ display_name: patch.display_name })
        .eq('id', fileId)
        .select('id,trip_id,zone_id,activity_id,display_name,storage_path,mime_type,size_bytes')
        .maybeSingle()
      return (data as FileAttachment) ?? null
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
        .select('id,trip_id,zone_id,activity_id,display_name,storage_path,mime_type,size_bytes')
        .eq('id', fileId)
        .maybeSingle()
      const file = (data as FileAttachment) ?? null
      return file && (await fileBelongs(tripId, file)) ? file : null
    },

    async reparentFilesToTrip(activityId, tripId) {
      await db
        .from('files')
        .update({ activity_id: null, trip_id: tripId })
        .eq('activity_id', activityId)
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

    // --- Chat (005) ---------------------------------------------------------

    async getActiveChatThread(tripId) {
      const { data, error } = await db
        .from('chat_threads')
        .select(CHAT_THREAD_COLS)
        // The partial unique index makes this at most one row (0024). Without
        // the archived filter it would be every conversation the trip has ever
        // had, and `maybeSingle` would start erroring on the second one.
        .eq('trip_id', tripId)
        .is('archived_at', null)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? rowToChatThread(data as Record<string, unknown>) : null
    },

    async createChatThread(tripId) {
      // Read-then-insert, with the duplicate handled rather than avoided.
      //
      // 0023 used an upsert on the unique `trip_id`, which closed the race where
      // two first sends both see no thread and both insert. 0024 replaced that
      // constraint with a *partial* unique index — `where archived_at is null` —
      // and `on conflict` cannot name a partial index without repeating its
      // predicate, which PostgREST will not do.
      //
      // So the race is caught instead of prevented: the loser gets 23505 and
      // re-reads the row the winner made. Same outcome, one more round trip in
      // a case that happens at most once per conversation.
      const existing = await this.getActiveChatThread(tripId)
      if (existing) return existing

      const { data, error } = await db
        .from('chat_threads')
        .insert({ id: randomUUID(), trip_id: tripId, turn_started_at: null, archived_at: null })
        .select(CHAT_THREAD_COLS)
        .single()

      if (error) {
        if (error.code !== '23505') throw new Error(error.message)
        const won = await this.getActiveChatThread(tripId)
        // Only reachable if the winner archived it between the two reads, which
        // needs a third actor. Loud rather than a null nobody expects.
        if (!won) throw new Error('chat thread vanished while being created')
        return won
      }
      return rowToChatThread(data as Record<string, unknown>)
    },

    async archiveChatThread(tripId) {
      // One statement: stamped and unlocked together, and scoped to the live
      // thread so re-archiving is a no-op rather than re-stamping history.
      //
      // Nothing is deleted — the messages stay pointing at this thread, which is
      // the whole difference from what 0023's schema allowed. `ai_usage` is
      // untouched: those rows hang off the trip and the account, never the
      // thread, so the monthly cap does not move.
      const { data, error } = await db
        .from('chat_threads')
        .update({ archived_at: new Date().toISOString(), turn_started_at: null })
        .eq('trip_id', tripId)
        .is('archived_at', null)
        .select('id')
      if (error) throw new Error(error.message)
      return ((data as unknown[]) ?? []).length > 0
    },

    async claimChatTurn(tripId, nowIso, staleMs) {
      // One statement: the lock is only taken if it is free or stale, and only
      // the row that was actually updated comes back — so two sends racing
      // cannot both believe they hold it. Reading then writing is exactly the
      // race this exists to close.
      //
      // `archived_at is null` is not decoration since 0024: without it this
      // would stamp a lock onto every finished conversation the trip has.
      const staleBefore = new Date(Date.parse(nowIso) - staleMs).toISOString()
      const { data, error } = await db
        .from('chat_threads')
        .update({ turn_started_at: nowIso })
        .eq('trip_id', tripId)
        .is('archived_at', null)
        .or(`turn_started_at.is.null,turn_started_at.lt.${staleBefore}`)
        .select(CHAT_THREAD_COLS)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? rowToChatThread(data as Record<string, unknown>) : null
    },

    async releaseChatTurn(tripId) {
      await db
        .from('chat_threads')
        .update({ turn_started_at: null })
        .eq('trip_id', tripId)
        .is('archived_at', null)
    },

    async listChatMessages(threadId) {
      const { data, error } = await db
        .from('chat_messages')
        .select(CHAT_MESSAGE_COLS)
        // By thread, never by trip. A trip now holds every conversation it has
        // ever had, and a trip-scoped read would return all of them — as a
        // transcript that will not clear, and as history from a finished
        // conversation being handed to the model. Migration 0024 adds the
        // matching `(thread_id, created_at)` index.
        .eq('thread_id', threadId)
        // `created_at` alone, and deliberately no tiebreak. Postgres `now()` is
        // microsecond-resolution and the question and its answer are written by
        // separate statements, so they cannot share a timestamp — while a
        // secondary sort on the random uuid would be worse than nothing, putting
        // an answer before its question whenever two rows did tie.
        .order('created_at', { ascending: true })
      if (error) throw new Error(error.message)
      return ((data as Record<string, unknown>[]) ?? []).map(rowToChatMessage)
    },

    async createChatMessage(input: ChatMessageInput) {
      const { data, error } = await db
        .from('chat_messages')
        .insert({ id: randomUUID(), ...input })
        .select(CHAT_MESSAGE_COLS)
        .single()
      if (error) throw new Error(error.message)
      return rowToChatMessage(data as Record<string, unknown>)
    },

    async recordAiUsage(input: AiUsageInput) {
      const { data, error } = await db
        .from('ai_usage')
        .insert({ id: randomUUID(), ...input, trip_id: input.trip_id ?? null })
        .select(AI_USAGE_COLS)
        .single()
      if (error) throw new Error(error.message)
      return rowToAiUsage(data as Record<string, unknown>)
    },

    async sumAiUsageCents(userId, sinceIso) {
      return sumUsage(sinceIso, userId)
    },

    async sumAllAiUsageCents(sinceIso) {
      return sumUsage(sinceIso)
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
      if (!term) return { activities: [], zones: [], tips: [] }
      const like = `%${term}%`

      // Scope first, then match. Searching the whole catalog and filtering
      // afterwards is what leaked other trips' notes before phase 3a-ii.
      const zoneIds = await zoneIdsFor(db, tripId)
      const activityIds = await activityIdsFor(db, tripId)

      const activityFilter = `name.ilike.${like},name_ja.ilike.${like},description.ilike.${like},address.ilike.${like}`
      // A tip belongs to this trip through whichever single parent it has.
      const tipScope = [
        zoneIds.length ? `zone_id.in.(${zoneIds.join(',')})` : null,
        activityIds.length ? `activity_id.in.(${activityIds.join(',')})` : null,
      ]
        .filter(Boolean)
        .join(',')
      const [activities, zones, tips] = await Promise.all([
        db.from('activities').select(ACTIVITY_COLS).eq('trip_id', tripId).or(activityFilter),
        zoneIds.length
          ? db
              .from('zones')
              .select(ZONE_COLS)
              .eq('trip_id', tripId)
              .or(`name.ilike.${like},name_ja.ilike.${like},summary.ilike.${like}`)
          : Promise.resolve({ data: [] as unknown[] }),
        tipScope
          ? db.from('tips').select('id,zone_id,activity_id,body').ilike('body', like).or(tipScope)
          : Promise.resolve({ data: [] as unknown[] }),
      ])
      return {
        activities: (activities.data as unknown as Activity[]) ?? [],
        zones: (zones.data as Zone[]) ?? [],
        tips: (tips.data as Tip[]) ?? [],
      }
    },
  }
}
