// Supabase implementation of the DataStore interface (DATA_BACKEND=supabase).
// Same contract as datastore.memory.ts — swapping backends changes no feature
// code. Column names already match the entity field names (snake_case).
import { randomUUID } from 'node:crypto'
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
import { FILES_BUCKET, getSupabase } from './supabase.js'

const SIGNED_URL_TTL = 300 // seconds

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

  return {
    async ping() {
      const { error } = await db.from('trips').select('id').limit(1)
      if (error) throw new Error(`Supabase unreachable: ${error.message}`)
    },

    async getTrip() {
      const { data } = await db
        .from('trips')
        .select('id,name,start_date,end_date,description')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      return (data as Trip) ?? null
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

    async getStep(stepId) {
      const { data } = await db
        .from('journey_steps')
        .select('id,trip_id,zone_id,position,start_date,end_date')
        .eq('id', stepId)
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

    async updateStep(stepId, patch) {
      const fields: Record<string, unknown> = {}
      if (patch.zone_id !== undefined) fields.zone_id = patch.zone_id
      if (patch.position !== undefined) fields.position = patch.position
      if (patch.start_date !== undefined) fields.start_date = patch.start_date
      if (patch.end_date !== undefined) fields.end_date = patch.end_date
      const { data, error } = await db
        .from('journey_steps')
        .update(fields)
        .eq('id', stepId)
        .select()
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as JourneyStep) ?? null
    },

    async deleteStep(stepId) {
      const { data } = await db.from('journey_steps').delete().eq('id', stepId).select('id')
      return (data?.length ?? 0) > 0
    },

    async listZones() {
      const { data } = await db
        .from('zones')
        .select('id,name,name_ja,summary,image_url,lat,lng')
        .order('name', { ascending: true })
      return (data as Zone[]) ?? []
    },

    async getZone(zoneId) {
      const { data } = await db
        .from('zones')
        .select('id,name,name_ja,summary,image_url,lat,lng')
        .eq('id', zoneId)
        .maybeSingle()
      return (data as Zone) ?? null
    },

    async createZone(input: ZoneInput) {
      const row = {
        id: randomUUID(),
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

    async countPlacesByCategory(zoneId) {
      const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
      const { data } = await db.from('places').select('category').eq('zone_id', zoneId)
      for (const row of (data as { category: Category }[]) ?? []) counts[row.category]++
      return counts
    },

    async listPlaces(zoneId, category) {
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

    async listPlacesInZone(zoneId) {
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

    async getPlace(placeId) {
      const run = (cols: string) => db.from('places').select(cols).eq('id', placeId).maybeSingle()
      let { data, error } = await run(PLACE_COLS)
      if (error && isMissingCoordColumn(error)) ({ data, error } = await run(PLACE_BASE_COLS))
      if (error) throw new Error(error.message)
      return (data as unknown as Place) ?? null
    },

    async createPlace(input: PlaceInput) {
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

    async updatePlace(placeId, patch) {
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
        db.from('places').update(f).eq('id', placeId).select().maybeSingle()
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

    async deletePlace(placeId) {
      // tips cascade via the DB foreign key
      const { data } = await db.from('places').delete().eq('id', placeId).select('id')
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
      if (error && isMissingHighlightColumn(error)) ({ data, error } = await run(ITINERARY_BASE_COLS))
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => withHighlightDefaults(r as unknown as Record<string, unknown>))
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

    async updateItineraryItem(itemId, patch) {
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
        db.from('itinerary_items').update(f).eq('id', itemId).select().maybeSingle()
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

    async deleteItineraryItem(itemId) {
      const { data } = await db.from('itinerary_items').delete().eq('id', itemId).select('id')
      return (data?.length ?? 0) > 0
    },

    async listTips(parent) {
      const q = db.from('tips').select('id,zone_id,place_id,body')
      const { data } =
        'zone_id' in parent
          ? await q.eq('zone_id', parent.zone_id)
          : await q.eq('place_id', parent.place_id)
      return (data as Tip[]) ?? []
    },

    async createTip(input: TipInput) {
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

    async updateTip(tipId, body) {
      const { data } = await db.from('tips').update({ body }).eq('id', tipId).select().maybeSingle()
      return (data as Tip) ?? null
    },

    async deleteTip(tipId) {
      const { data } = await db.from('tips').delete().eq('id', tipId).select('id')
      return (data?.length ?? 0) > 0
    },

    async listFiles(parent) {
      const q = db.from('files').select('id,trip_id,zone_id,place_id,display_name,storage_path,mime_type,size_bytes')
      let res
      if ('trip_id' in parent) res = await q.eq('trip_id', parent.trip_id)
      else if ('zone_id' in parent) res = await q.eq('zone_id', parent.zone_id)
      else res = await q.eq('place_id', parent.place_id)
      return (res.data as FileAttachment[]) ?? []
    },

    async listAllFiles() {
      const { data } = await db
        .from('files')
        .select('id,trip_id,zone_id,place_id,display_name,storage_path,mime_type,size_bytes')
        .order('created_at', { ascending: true })
      return (data as FileAttachment[]) ?? []
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

    async deleteFile(fileId) {
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

    async getFile(fileId) {
      const { data } = await db
        .from('files')
        .select('id,trip_id,zone_id,place_id,display_name,storage_path,mime_type,size_bytes')
        .eq('id', fileId)
        .maybeSingle()
      return (data as FileAttachment) ?? null
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

    async getLatestRates() {
      const { data } = await db
        .from('exchange_rates')
        .select('base,date,usd,ils')
        .eq('base', 'JPY')
        .maybeSingle()
      return (data as ExchangeRates) ?? null
    },

    async saveRates(rates: ExchangeRates) {
      await db.from('exchange_rates').upsert(
        { base: rates.base, date: rates.date, usd: rates.usd, ils: rates.ils, fetched_at: new Date().toISOString() },
        { onConflict: 'base' }
      )
    },

    async search(query) {
      // strip chars that would break PostgREST's or() filter grammar
      const term = query.replace(/[%,()]/g, ' ').trim()
      if (!term) return { places: [], zones: [], tips: [] }
      const like = `%${term}%`
      const placeFilter = `name.ilike.${like},name_ja.ilike.${like},description.ilike.${like},address.ilike.${like}`
      const searchPlaces = async () => {
        const run = (cols: string) => db.from('places').select(cols).or(placeFilter)
        let { data, error } = await run(PLACE_COLS)
        if (error && isMissingCoordColumn(error)) ({ data, error } = await run(PLACE_BASE_COLS))
        return (data as unknown as Place[]) ?? []
      }
      const [places, zones, tips] = await Promise.all([
        searchPlaces(),
        db
          .from('zones')
          .select('id,name,name_ja,summary,image_url,lat,lng')
          .or(`name.ilike.${like},name_ja.ilike.${like},summary.ilike.${like}`),
        db.from('tips').select('id,zone_id,place_id,body').ilike('body', like),
      ])
      return {
        places,
        zones: (zones.data as Zone[]) ?? [],
        tips: (tips.data as Tip[]) ?? [],
      }
    },
  }
}
