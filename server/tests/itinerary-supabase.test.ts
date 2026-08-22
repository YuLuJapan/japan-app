// The Supabase store must keep working when a deploy ships the highlight/icon
// columns before migration 0004 is applied: the query errors with
// undefined_column (42703) and the store falls back to the pre-0004 shape.
// We fake the Supabase query builder so we can assert that fallback without a DB.
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Toggled per test; the fake client reads it to decide whether the new columns
// "exist" in the schema.
let hasNewColumns = true

const UNDEFINED_COLUMN = {
  code: '42703',
  message: 'column itinerary_items.highlight does not exist',
}

// A minimal chainable stand-in for the Supabase query builder. It records the
// requested columns / written row, then resolves success or an undefined_column
// error depending on `hasNewColumns`.
function fakeBuilder() {
  const state: {
    op: 'select' | 'insert' | 'update'
    cols: string
    row: Record<string, unknown> | null
  } = {
    op: 'select',
    cols: '',
    row: null,
  }

  const referencesNewColumns = () => {
    if (state.op === 'select') return /highlight|icon/.test(state.cols)
    return !!state.row && 'highlight' in state.row
  }

  const result = () => {
    if (!hasNewColumns && referencesNewColumns()) return { data: null, error: UNDEFINED_COLUMN }
    if (state.op === 'select') {
      const base = {
        id: 'itin-1',
        trip_id: 't1',
        zone_id: null,
        place_id: null,
        day: '2026-09-20',
        start_time: null,
        title: 'Test',
        note: null,
        position: 0,
      }
      const row = hasNewColumns ? { ...base, highlight: true, icon: '🎂' } : base
      return { data: [row], error: null }
    }
    // insert / update echo back what was written (id filled in for update)
    return { data: { id: 'itin-1', ...state.row }, error: null }
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
    single: async () => result(),
    maybeSingle: async () => result(),
    then: (resolve: (v: unknown) => unknown) => resolve(result()),
  }
  return builder
}

vi.mock('../src/lib/supabase.js', () => ({
  getSupabase: () => ({ from: () => fakeBuilder() }),
  FILES_BUCKET: 'trip-files',
}))

const { createSupabaseStore } = await import('../src/lib/datastore.supabase.js')

describe('supabase itinerary store — migration 0004 tolerance', () => {
  beforeEach(() => {
    hasNewColumns = true
  })

  it('returns highlight/icon when the columns exist', async () => {
    const store = createSupabaseStore()
    const items = await store.listItinerary('t1')
    expect(items[0].highlight).toBe(true)
    expect(items[0].icon).toBe('🎂')
  })

  it('still lists the itinerary when the columns are missing (falls back)', async () => {
    hasNewColumns = false
    const store = createSupabaseStore()
    const items = await store.listItinerary('t1')
    expect(items).toHaveLength(1) // did not blank out
    expect(items[0].title).toBe('Test')
    expect(items[0].highlight).toBe(false) // defaulted
    expect(items[0].icon).toBeNull()
  })

  it('creates an item even when the columns are missing', async () => {
    hasNewColumns = false
    const store = createSupabaseStore()
    const item = await store.createItineraryItem({
      trip_id: 't1',
      day: '2026-09-20',
      title: 'New',
      highlight: true,
      icon: '🚗',
    })
    expect(item.id).toBeTruthy()
    expect(item.title).toBe('New')
    expect(item.highlight).toBe(false) // silently degraded until migration runs
  })

  it('updates an item even when the columns are missing', async () => {
    hasNewColumns = false
    const store = createSupabaseStore()
    const item = await store.updateItineraryItem('itin-1', { title: 'Edited', highlight: true })
    expect(item?.title).toBe('Edited')
  })
})
