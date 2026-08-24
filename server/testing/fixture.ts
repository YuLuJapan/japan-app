// The deterministic dataset every API test starts from, written into a real
// Postgres through PostgREST — the same path the app writes by.
//
// Same content as the old in-memory fixture, with one forced change: the
// account ids are UUIDs. `profiles.id`, `trip_members.user_id`,
// `trip_invites.invited_by` and `push_subscriptions.user_id` are all `uuid`
// columns, and the memory store was happy to hold 'user-yuval' in them. That
// divergence is the kind this migration exists to remove.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  OUTSIDER_USER,
  OWNER_USER,
  PARTNER_USER,
  UNCONFIRMED_USER,
  VIEWER_USER,
} from './accounts.js'
import { FILES_BUCKET } from './stack-config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const PLACEHOLDER_FILES = path.join(here, '../../public/placeholder-files')

export { OUTSIDER_USER, OWNER_USER, PARTNER_USER, UNCONFIRMED_USER, VIEWER_USER }

const profiles = [OWNER_USER, PARTNER_USER, VIEWER_USER, OUTSIDER_USER, UNCONFIRMED_USER].map(
  (u) => ({ id: u.id, email: u.email, display_name: u.display_name, avatar_url: null })
)

const members = [
  {
    trip_id: 'trip-1',
    user_id: OWNER_USER.id,
    role: 'owner',
    can_see_stays: true,
    can_see_flight: true,
    can_see_documents: true,
    can_see_shopping: true,
  },
  // A second tenant, so "does not leak across trips" can be asserted against
  // real data rather than an empty database.
  {
    trip_id: 'trip-2',
    user_id: PARTNER_USER.id,
    role: 'owner',
    can_see_stays: true,
    can_see_flight: true,
    can_see_documents: true,
    can_see_shopping: true,
  },
]

const trips = [
  {
    id: 'trip-1',
    name: 'Test Trip',
    country: 'Japan',
    start_date: '2026-10-01',
    end_date: '2026-10-14',
    description: null,
    people: [{ name: 'Alex' }, { name: 'Sam' }],
    local_currency: 'JPY',
    home_currencies: ['USD', 'ILS'],
    start_time: null,
    start_tz: null,
    flight: {
      airline: 'Test Air',
      booking_ref: 'TESTREF',
      outbound: {
        depart_at: '2026-10-01T08:00:00+03:00',
        depart_tz: 'Asia/Jerusalem',
        arrive_at: '2026-10-02T06:00:00+09:00',
        arrive_tz: 'Asia/Tokyo',
        legs: [{ flight_no: 'TA 1', from: 'Tel Aviv (TLV)', to: 'Narita (NRT)' }],
      },
      return_flight: {
        depart_at: '2026-10-14T10:00:00+09:00',
        depart_tz: 'Asia/Tokyo',
        arrive_at: '2026-10-14T18:00:00+03:00',
        arrive_tz: 'Asia/Jerusalem',
        legs: [{ flight_no: 'TA 2', from: 'Narita (NRT)', to: 'Tel Aviv (TLV)' }],
      },
    },
  },
  {
    id: 'trip-2',
    name: 'Someone Else’s Trip',
    country: 'Italy',
    start_date: '2026-11-01',
    end_date: '2026-11-10',
    description: null,
    people: [{ name: 'Sam' }],
    // Italy, so euros in and dollars out — the second trip is where the
    // currency choice is exercised (trip-1 keeps the JPY→USD/ILS default).
    local_currency: 'EUR',
    home_currencies: ['USD'],
    start_time: null,
    start_tz: null,
    // No booking attached — what every trip looks like until someone adds one.
    flight: null,
  },
]

const zones = [
  {
    id: 'zone-tokyo',
    trip_id: 'trip-1',
    name: 'Tokyo',
    name_ja: '東京',
    summary: 'Big city',
    image_url: null,
    lat: null,
    lng: null,
  },
  {
    id: 'zone-kyoto',
    trip_id: 'trip-1',
    name: 'Kyoto',
    name_ja: '京都',
    summary: 'Old capital',
    image_url: null,
    lat: null,
    lng: null,
  },
  {
    id: 'zone-osaka',
    trip_id: 'trip-2',
    name: 'Osaka',
    name_ja: '大阪',
    summary: 'Someone else’s city',
    image_url: null,
    lat: null,
    lng: null,
  },
]

const steps = [
  {
    id: 'step-other',
    trip_id: 'trip-2',
    zone_id: 'zone-osaka',
    position: 1,
    start_date: '2026-11-02',
    end_date: '2026-11-06',
  },
  {
    id: 'step-2',
    trip_id: 'trip-1',
    zone_id: 'zone-kyoto',
    position: 2,
    start_date: '2026-10-09',
    end_date: '2026-10-12',
  },
  {
    id: 'step-1',
    trip_id: 'trip-1',
    zone_id: 'zone-tokyo',
    position: 1,
    start_date: '2026-10-05',
    end_date: '2026-10-09',
  },
]

const places = [
  {
    id: 'place-ramen',
    zone_id: 'zone-tokyo',
    category: 'food',
    name: 'Ramen Bar',
    name_ja: null,
    description:
      'A very long description that should be trimmed into a summary line for lists, exceeding one hundred characters in total length for the test.',
    address: 'Shinjuku',
    links: [{ label: 'Site', url: 'https://example.com' }],
  },
  {
    id: 'place-hotel',
    zone_id: 'zone-tokyo',
    category: 'hotel',
    name: 'Test Hotel',
    name_ja: null,
    description: null,
    address: null,
    links: [],
  },
  {
    id: 'place-other',
    zone_id: 'zone-osaka',
    category: 'hotel',
    name: 'Secret Osaka Hotel',
    name_ja: null,
    description: 'Confirmation ABC123, paid ¥40000',
    address: null,
    links: [],
  },
]

const tips = [
  { id: 'tip-zone', zone_id: 'zone-tokyo', place_id: null, body: 'Get a Suica card' },
  { id: 'tip-place', zone_id: null, place_id: 'place-ramen', body: 'Cash only' },
  { id: 'tip-other', zone_id: 'zone-osaka', place_id: null, body: 'Secret Osaka plan' },
]

const itinerary = [
  {
    id: 'itin-ramen',
    trip_id: 'trip-1',
    zone_id: 'zone-tokyo',
    place_id: 'place-ramen',
    day: '2026-10-06',
    start_time: '20:00',
    title: 'Ramen Bar',
    note: null,
    position: 0,
    highlight: false,
    icon: null,
  },
  {
    id: 'itin-walk',
    trip_id: 'trip-1',
    zone_id: 'zone-tokyo',
    place_id: null,
    day: '2026-10-06',
    start_time: null,
    title: 'Walk Shinjuku',
    note: 'After dinner',
    position: 0,
    highlight: false,
    icon: null,
  },
]

const shopping = [
  {
    id: 'shop-shoes',
    trip_id: 'trip-1',
    name: 'Onitsuka Tiger Mexico 66',
    category: 'clothes',
    note: 'Size 42',
    shop: 'Onitsuka Tiger Ginza',
    zone_id: 'zone-tokyo',
    price_yen: 12000,
    url: null,
    image_url: null,
    bought: false,
    position: 0,
  },
  {
    id: 'shop-shampoo',
    trip_id: 'trip-1',
    name: 'Ichikami shampoo',
    category: 'haircare',
    note: null,
    shop: 'Don Quijote',
    zone_id: null,
    price_yen: 900,
    url: null,
    image_url: null,
    bought: true,
    position: 0,
  },
]

/**
 * `blob` names the file under public/placeholder-files whose bytes back the
 * row. `file-gone` deliberately has none: a row whose blob is missing is a
 * real state (someone deleted it out of band) and the API answers FILE_MISSING
 * rather than 404 for it. Against real storage that case has to be *built*,
 * not asserted into existence.
 */
const files = [
  {
    row: {
      id: 'file-trip',
      trip_id: 'trip-1',
      zone_id: null,
      place_id: null,
      display_name: 'Flight booking',
      storage_path: 'placeholder-files/flight-booking.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1000,
    },
    blob: 'flight-booking.pdf',
  },
  {
    row: {
      id: 'file-place',
      trip_id: null,
      zone_id: null,
      place_id: 'place-ramen',
      display_name: 'Menu photo',
      storage_path: 'placeholder-files/kyoto-walking-map.svg',
      mime_type: 'image/svg+xml',
      size_bytes: 500,
    },
    blob: 'kyoto-walking-map.svg',
  },
  {
    row: {
      id: 'file-gone',
      trip_id: null,
      zone_id: 'zone-kyoto',
      place_id: null,
      display_name: 'Missing map',
      storage_path: 'placeholder-files/does-not-exist.pdf',
      mime_type: 'application/pdf',
      size_bytes: 100,
    },
    blob: null,
  },
]

/** Every table the fixture fills, in an order foreign keys accept. */
const TABLES: [string, unknown[]][] = [
  ['profiles', profiles],
  ['trips', trips],
  ['trip_members', members],
  ['zones', zones],
  ['journey_steps', steps],
  ['places', places],
  ['tips', tips],
  ['itinerary_items', itinerary],
  ['shopping_items', shopping],
  ['files', files.map((f) => f.row)],
]

/**
 * Writes the fixture into an empty database.
 *
 * Assumes `resetData` has just run: these are plain inserts, so a leftover row
 * is a primary-key error rather than a silent overwrite — which is what you
 * want from a fixture that is supposed to start from nothing.
 */
export async function seedFixture(db: SupabaseClient): Promise<void> {
  for (const [table, rows] of TABLES) {
    if (!rows.length) continue
    // profiles is upserted rather than inserted. The API records the signed-in
    // account on every authenticated request, so a request still in flight
    // when the previous test was torn down can re-create that row between the
    // truncate and here. Every other table is a plain insert, so a leftover
    // anywhere else is still a loud primary-key error rather than a silent
    // overwrite.
    const write =
      table === 'profiles'
        ? db.from(table).upsert(rows as never, { onConflict: 'id' })
        : db.from(table).insert(rows as never)
    const { error } = await write
    // The whole error, not just `.message`: PostgREST reports a missing table
    // or a constraint violation in `code`/`details`/`hint`, and a bare
    // "undefined" is a miserable thing to debug a fixture with.
    if (error) throw new Error(`seeding ${table} failed: ${JSON.stringify(error)}`)
  }

  for (const { row, blob } of files) {
    if (!blob) continue
    const bytes = readFileSync(path.join(PLACEHOLDER_FILES, blob))
    // upsert: the blobs outlive a truncate of storage.objects, so a second
    // test would otherwise collide with the first one's upload.
    const { error } = await db.storage
      .from(FILES_BUCKET)
      .upload(row.storage_path, bytes, { contentType: row.mime_type, upsert: true })
    if (error) throw new Error(`uploading ${row.storage_path} failed: ${error.message}`)
  }
}
