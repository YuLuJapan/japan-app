// What replaced the two column-fallback tests (places-supabase, itinerary-supabase).
//
// Those existed because `places` and `itinerary_items` each grew columns in
// later migrations, and a deploy could ship the code before the migration ran —
// so the store asked for the widest column list it could and narrowed on an
// undefined_column error. Migration 0025 leaves one table carrying every
// column, so there is no tier to fall back to: if 0025 has not run, the *table*
// is absent, which PostgREST reports plainly instead of as a missing column.
//
// One guard from that pair is still real, and it is the one that failed
// silently rather than loudly:
//
//   Reads use an explicit column list. Omit a column there and the write path
//   (which selects everything it inserted) answers with the new field, while
//   the very next list read hands back a row without it — which looks exactly
//   like the value never saved.
//
// So: the read list must name every column an `Activity` has. This is a type
// test wearing a runtime coat — `keyof Activity` is the source of truth, and
// adding a column to the entity fails here until it is added to the query too.
import { describe, expect, it } from 'vitest'
import { ACTIVITY_COLS } from '../src/lib/datastore.supabase.js'
import type { Activity } from '../src/lib/datastore.js'

/**
 * Every key of `Activity`, listed rather than derived: a type has no runtime
 * shape, so the list is written out and the `Record` makes leaving one off a
 * compile error. Same trick as the export's field policy.
 */
const ACTIVITY_KEYS: Record<keyof Activity, true> = {
  id: true,
  trip_id: true,
  zone_id: true,
  category: true,
  name: true,
  name_ja: true,
  description: true,
  address: true,
  links: true,
  image_url: true,
  lat: true,
  lng: true,
  day: true,
  start_time: true,
  position: true,
  highlight: true,
  icon: true,
}

describe('the Supabase read column list', () => {
  it('asks for every column an activity has', () => {
    const asked = new Set(ACTIVITY_COLS.split(',').map((c) => c.trim()))
    const missing = Object.keys(ACTIVITY_KEYS).filter((key) => !asked.has(key))
    expect(missing).toEqual([])
  })

  it('asks for nothing an activity does not have', () => {
    // The other direction, and not pedantry: a column that has been dropped or
    // renamed makes PostgREST reject the whole query, so every list read on the
    // trip 500s at once.
    const known = new Set(Object.keys(ACTIVITY_KEYS))
    const extra = ACTIVITY_COLS.split(',')
      .map((c) => c.trim())
      .filter((c) => !known.has(c))
    expect(extra).toEqual([])
  })
})
