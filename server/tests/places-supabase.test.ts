// The Supabase store must keep working when a deploy ships before migration
// 0005 adds places.lat/lng: the query errors with undefined_column (42703) and
// the store retries without the coordinates — except when coordinates are the
// only thing being written, which must fail loudly rather than report a
// phantom "not found".
//
// The columns are really renamed away for the duration rather than simulated
// by a fake query builder, so 42703 comes from Postgres and the fallback is
// exercised by the condition it was written for.
import { describe, expect, it } from 'vitest'
import { getDataStore } from '../src/lib/datastore.js'
import { withColumnsMissing } from '../testing/db.js'

/** The pre-0005 shape: the coordinate columns, gone. */
const beforeMigration0005 = <T>(fn: () => Promise<T>) =>
  withColumnsMissing('places', ['lat', 'lng'], fn)

describe('supabase places store — migration 0005 tolerance', () => {
  it('returns lat/lng when the columns exist', async () => {
    const store = await getDataStore()
    await store.updatePlace('trip-1', 'place-ramen', { lat: 35.6, lng: 139.7 })

    const place = await store.getPlace('trip-1', 'place-ramen')
    expect(place?.lat).toBe(35.6)
    expect(place?.lng).toBe(139.7)
  })

  it('still returns the place when the columns are missing (falls back)', async () => {
    const store = await getDataStore()

    await beforeMigration0005(async () => {
      const place = await store.getPlace('trip-1', 'place-ramen')
      expect(place?.name).toBe('Ramen Bar')
    })
  })

  it('updates other fields even when the coordinate columns are missing', async () => {
    const store = await getDataStore()

    await beforeMigration0005(async () => {
      const place = await store.updatePlace('trip-1', 'place-ramen', {
        name: 'Renamed',
        lat: 35.6,
        lng: 139.7,
      })
      expect(place?.name).toBe('Renamed')
    })
  })

  it('fails loudly (not a false "not found") when only coordinates are patched and the migration has not run', async () => {
    const store = await getDataStore()

    await beforeMigration0005(async () => {
      await expect(
        store.updatePlace('trip-1', 'place-ramen', { lat: 35.6, lng: 139.7 })
      ).rejects.toThrow(/0005_place_coords/)
    })
  })
})
