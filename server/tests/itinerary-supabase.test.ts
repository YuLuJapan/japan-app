// The Supabase store must keep working when a deploy ships the highlight/icon
// columns before migration 0004 is applied: the query errors with
// undefined_column (42703) and the store falls back to the pre-0004 shape.
//
// This used to be asserted against a hand-built Supabase query builder that
// agreed to answer 42703 when asked for the new columns — which proves the
// fallback runs when something says 42703, not that Postgres says it. The
// columns are now really renamed away for the duration, so the error comes
// from the database and the recovery is the one that would happen in
// production.
import { describe, expect, it } from 'vitest'
import { getDataStore } from '../src/lib/datastore.js'
import { withColumnsMissing } from '../testing/db.js'

/** The pre-0004 shape: the columns that arrive with that migration, gone. */
const beforeMigration0004 = <T>(fn: () => Promise<T>) =>
  withColumnsMissing('itinerary_items', ['highlight', 'icon'], fn)

describe('supabase itinerary store — migration 0004 tolerance', () => {
  it('returns highlight/icon when the columns exist', async () => {
    const store = await getDataStore()
    const created = await store.createItineraryItem({
      trip_id: 'trip-1',
      day: '2026-10-06',
      title: 'Birthday dinner',
      highlight: true,
      icon: '🎂',
    })

    const items = await store.listItinerary('trip-1')
    const item = items.find((i) => i.id === created.id)
    expect(item?.highlight).toBe(true)
    expect(item?.icon).toBe('🎂')
  })

  it('still lists the itinerary when the columns are missing (falls back)', async () => {
    const store = await getDataStore()

    await beforeMigration0004(async () => {
      const items = await store.listItinerary('trip-1')
      expect(items.length).toBeGreaterThan(0) // did not blank out
      expect(items.map((i) => i.title)).toContain('Ramen Bar')
      expect(items[0].highlight).toBe(false) // defaulted
      expect(items[0].icon).toBeNull()
    })
  })

  it('creates an item even when the columns are missing', async () => {
    const store = await getDataStore()

    await beforeMigration0004(async () => {
      const item = await store.createItineraryItem({
        trip_id: 'trip-1',
        day: '2026-10-06',
        title: 'New',
        highlight: true,
        icon: '🚗',
      })
      expect(item.id).toBeTruthy()
      expect(item.title).toBe('New')
      expect(item.highlight).toBe(false) // silently degraded until migration runs
    })
  })

  it('updates an item even when the columns are missing', async () => {
    const store = await getDataStore()

    await beforeMigration0004(async () => {
      const item = await store.updateItineraryItem('trip-1', 'itin-ramen', {
        title: 'Edited',
        highlight: true,
      })
      expect(item?.title).toBe('Edited')
    })
  })
})
