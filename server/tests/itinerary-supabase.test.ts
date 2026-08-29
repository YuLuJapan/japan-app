// The Supabase store must keep working when a deploy ships a column before its
// migration is applied — highlight/icon (0004), category (0022): the query
// errors with undefined_column (42703) and the store falls back to the narrower
// shape. It must also *ask for* every column that does exist, or a saved value
// comes back on the write and vanishes on the next read.
// We fake the Supabase query builder so we can assert both without a DB.
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Toggled per test; the fake client reads them to decide which columns "exist"
// in the schema.
let hasNewColumns = true
let hasCategoryColumn = true

const undefinedColumn = (name: string) => ({
  code: '42703',
  message: `column itinerary_items.${name} does not exist`,
})

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

  const references = (name: string) => {
    if (state.op === 'select') return state.cols.split(',').includes(name)
    return !!state.row && name in state.row
  }

  // `single` returns the row itself, `then` (a list query) an array of them —
  // the store spreads whatever comes back, so the fake has to tell them apart.
  const result = (one = false) => {
    if (!hasNewColumns && (references('highlight') || references('icon')))
      return { data: null, error: undefinedColumn('highlight') }
    if (!hasCategoryColumn && references('category'))
      return { data: null, error: undefinedColumn('category') }
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
      const withHighlight = hasNewColumns ? { ...base, highlight: true, icon: '🎂' } : base
      const row = hasCategoryColumn ? { ...withHighlight, category: 'food' } : withHighlight
      return { data: one ? row : [row], error: null }
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
    single: async () => result(true),
    maybeSingle: async () => result(true),
    then: (resolve: (v: unknown) => unknown) => resolve(result()),
  }
  return builder
}

vi.mock('../src/lib/supabase.js', () => ({
  getSupabase: () => ({ from: () => fakeBuilder() }),
  FILES_BUCKET: 'trip-files',
}))

const { createSupabaseStore } = await import('../src/lib/datastore.supabase.js')

describe('supabase itinerary store — migration tolerance', () => {
  beforeEach(() => {
    hasNewColumns = true
    hasCategoryColumn = true
  })

  it('reads back the stored category', async () => {
    // Regression: the read path used an explicit column list that omitted
    // `category`, so a just-tagged activity came back untagged on the next list.
    const store = createSupabaseStore()
    const items = await store.listItinerary('t1')
    expect(items[0].category).toBe('food')
    const item = await store.getItineraryItem('t1', 'itin-1')
    expect(item?.category).toBe('food')
  })

  it('keeps highlight/icon when only the category column is missing', async () => {
    hasCategoryColumn = false
    const store = createSupabaseStore()
    const items = await store.listItinerary('t1')
    expect(items[0].category).toBeNull() // inert until 0022 runs
    expect(items[0].highlight).toBe(true) // but 0004 is not given up with it
    expect(items[0].icon).toBe('🎂')
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
    const item = await store.updateItineraryItem('trip-1', 'itin-1', {
      title: 'Edited',
      highlight: true,
    })
    expect(item?.title).toBe('Edited')
  })
})
