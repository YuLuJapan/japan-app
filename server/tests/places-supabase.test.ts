// The Supabase store must keep working when a deploy ships the lat/lng
// columns before migration 0005 is applied: the query errors with
// undefined_column (42703) and the store falls back to the pre-0005 shape.
// We fake the Supabase query builder so we can assert that fallback without a DB.
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Toggled per test; the fake client reads it to decide whether the new columns
// "exist" in the schema.
let hasCoordColumns = true

const UNDEFINED_COLUMN = { code: '42703', message: 'column places.lat does not exist' }

function fakeBuilder() {
  const state: { op: 'select' | 'insert' | 'update'; cols: string; row: Record<string, unknown> | null } = {
    op: 'select',
    cols: '',
    row: null,
  }

  const referencesCoords = () => {
    if (state.op === 'select') return /lat|lng/.test(state.cols)
    return !!state.row && ('lat' in state.row || 'lng' in state.row)
  }

  const row = () => {
    const base = {
      id: 'place-1',
      zone_id: 'zone-1',
      category: 'attraction',
      name: 'Test Place',
      name_ja: null,
      description: null,
      address: null,
      links: [],
      image_url: null,
    }
    return hasCoordColumns ? { ...base, lat: 35.6, lng: 139.7 } : base
  }

  // maybeSingle()/single() resolve to one row (or null); then() (a plain
  // array select, as the list* methods use) resolves to an array.
  const result = (single: boolean) => {
    if (!hasCoordColumns && referencesCoords()) return { data: null, error: UNDEFINED_COLUMN }
    if (state.op === 'select') return { data: single ? row() : [row()], error: null }
    if (state.op === 'update') {
      // an update whose SET clause is empty matches no row (this is the real
      // Postgres/PostgREST behaviour a bug in updatePlace relied on)
      if (Object.keys(state.row ?? {}).length === 0) return { data: null, error: null }
      return { data: { id: 'place-1', ...state.row }, error: null }
    }
    return { data: { id: 'place-1', ...state.row }, error: null }
  }

  const builder: Record<string, unknown> = {
    select: (cols?: string) => {
      if (state.op === 'select') state.cols = cols ?? ''
      return builder
    },
    insert: (row: Record<string, unknown>) => {
      state.op = 'insert'
      state.row = row
      return builder
    },
    update: (row: Record<string, unknown>) => {
      state.op = 'update'
      state.row = row
      return builder
    },
    eq: () => builder,
    order: () => builder,
    single: async () => result(true),
    maybeSingle: async () => result(true),
    then: (resolve: (v: unknown) => unknown) => resolve(result(false)),
  }
  return builder
}

vi.mock('../src/lib/supabase.js', () => ({
  getSupabase: () => ({ from: () => fakeBuilder() }),
  FILES_BUCKET: 'trip-files',
}))

const { createSupabaseStore } = await import('../src/lib/datastore.supabase.js')

describe('supabase places store — migration 0005 tolerance', () => {
  beforeEach(() => {
    hasCoordColumns = true
  })

  it('returns lat/lng when the columns exist', async () => {
    const store = createSupabaseStore()
    const place = await store.getPlace('place-1')
    expect(place?.lat).toBe(35.6)
    expect(place?.lng).toBe(139.7)
  })

  it('still returns the place when the columns are missing (falls back)', async () => {
    hasCoordColumns = false
    const store = createSupabaseStore()
    const place = await store.getPlace('place-1')
    expect(place?.name).toBe('Test Place')
  })

  it('updates other fields even when the coordinate columns are missing', async () => {
    hasCoordColumns = false
    const store = createSupabaseStore()
    const place = await store.updatePlace('place-1', { name: 'Renamed', lat: 35.6, lng: 139.7 })
    expect(place?.name).toBe('Renamed')
  })

  it('fails loudly (not a false "not found") when only coordinates are patched and the migration has not run', async () => {
    hasCoordColumns = false
    const store = createSupabaseStore()
    await expect(store.updatePlace('place-1', { lat: 35.6, lng: 139.7 })).rejects.toThrow(
      /0005_place_coords/
    )
  })
})
