// Supabase implementation of the DataStore interface (DATA_BACKEND=supabase).
// Same contract as datastore.memory.ts — swapping backends changes no feature
// code. Column names already match the entity field names (snake_case).
import { randomUUID } from 'node:crypto'
import type {
  Category,
  DataStore,
  FileAttachment,
  FileUrlResult,
  ItineraryItem,
  ItineraryItemInput,
  JourneyStep,
  Place,
  PlaceInput,
  Tip,
  TipInput,
  Trip,
  Zone,
} from './datastore.js'
import { CATEGORIES } from './datastore.js'
import { FILES_BUCKET, getSupabase } from './supabase.js'

const SIGNED_URL_TTL = 300 // seconds

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
        .order('position', { ascending: true })
      return (data as JourneyStep[]) ?? []
    },

    async getZone(zoneId) {
      const { data } = await db
        .from('zones')
        .select('id,name,name_ja,summary,image_url,lat,lng')
        .eq('id', zoneId)
        .maybeSingle()
      return (data as Zone) ?? null
    },

    async countPlacesByCategory(zoneId) {
      const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
      const { data } = await db.from('places').select('category').eq('zone_id', zoneId)
      for (const row of (data as { category: Category }[]) ?? []) counts[row.category]++
      return counts
    },

    async listPlaces(zoneId, category) {
      const { data } = await db
        .from('places')
        .select('id,zone_id,category,name,name_ja,description,address,links,image_url')
        .eq('zone_id', zoneId)
        .eq('category', category)
        .order('created_at', { ascending: true })
      return (data as Place[]) ?? []
    },

    async getPlace(placeId) {
      const { data } = await db
        .from('places')
        .select('id,zone_id,category,name,name_ja,description,address,links,image_url')
        .eq('id', placeId)
        .maybeSingle()
      return (data as Place) ?? null
    },

    async createPlace(input: PlaceInput) {
      const row = {
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
      const { data, error } = await db.from('places').insert(row).select().single()
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
      const { data } = await db.from('places').update(fields).eq('id', placeId).select().maybeSingle()
      return (data as Place) ?? null
    },

    async deletePlace(placeId) {
      // tips cascade via the DB foreign key
      const { data } = await db.from('places').delete().eq('id', placeId).select('id')
      return (data?.length ?? 0) > 0
    },

    async listItinerary(tripId) {
      const { data } = await db
        .from('itinerary_items')
        .select('id,trip_id,zone_id,place_id,day,start_time,title,note,position')
        .eq('trip_id', tripId)
        .order('day', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: false })
        .order('position', { ascending: true })
      return (data as ItineraryItem[]) ?? []
    },

    async createItineraryItem(input: ItineraryItemInput) {
      const row = {
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
      const { data, error } = await db.from('itinerary_items').insert(row).select().single()
      if (error) throw new Error(error.message)
      return data as ItineraryItem
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
      const { data } = await db
        .from('itinerary_items')
        .update(fields)
        .eq('id', itemId)
        .select()
        .maybeSingle()
      return (data as ItineraryItem) ?? null
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

    async countTripFiles(tripId) {
      const { count } = await db
        .from('files')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', tripId)
      return count ?? 0
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

    async search(query) {
      // strip chars that would break PostgREST's or() filter grammar
      const term = query.replace(/[%,()]/g, ' ').trim()
      if (!term) return { places: [], zones: [], tips: [] }
      const like = `%${term}%`
      const [places, zones, tips] = await Promise.all([
        db
          .from('places')
          .select('id,zone_id,category,name,name_ja,description,address,links,image_url')
          .or(`name.ilike.${like},name_ja.ilike.${like},description.ilike.${like},address.ilike.${like}`),
        db
          .from('zones')
          .select('id,name,name_ja,summary,image_url,lat,lng')
          .or(`name.ilike.${like},name_ja.ilike.${like},summary.ilike.${like}`),
        db.from('tips').select('id,zone_id,place_id,body').ilike('body', like),
      ])
      return {
        places: (places.data as Place[]) ?? [],
        zones: (zones.data as Zone[]) ?? [],
        tips: (tips.data as Tip[]) ?? [],
      }
    },
  }
}
