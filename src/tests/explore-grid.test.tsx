// The Explore grid on a city page, once it can read the plan (feature 010, US1).
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type { ItineraryItem, TripShows } from '../api/types'
import Zone from '../pages/Zone'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const counts = { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 }

// Tokyo Oct 5–9, then Kyoto Oct 9–12 — Oct 9 is the shared moving day.
const bundle = {
  trip: {
    id: 'trip-1',
    name: 'Japan',
    country: 'Japan',
    display_title: 'Japan',
    start_date: '2026-10-05',
    end_date: '2026-10-12',
    description: null,
    people: [],
    local_currency: 'JPY',
    home_currencies: ['USD'],
    start_time: null,
    start_tz: null,
  },
  steps: [
    {
      id: 's1',
      position: 1,
      start_date: '2026-10-05',
      end_date: '2026-10-09',
      zone: { id: 'zone-1', name: 'Tokyo', name_ja: null, summary: null, place_counts: counts },
    },
    {
      id: 's2',
      position: 2,
      start_date: '2026-10-09',
      end_date: '2026-10-12',
      zone: { id: 'zone-2', name: 'Kyoto', name_ja: null, summary: null, place_counts: counts },
    },
  ],
  trip_files_count: 0,
  flight: null,
}

let n = 0
const item = (over: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id: `i${++n}`,
  trip_id: 'trip-1',
  zone_id: 'zone-1',
  place_id: null,
  day: '2026-10-06',
  start_time: null,
  title: `activity ${n}`,
  note: null,
  position: 0,
  highlight: false,
  icon: null,
  ...over,
})

function renderZone(
  place_counts: typeof counts,
  items: ItineraryItem[],
  shows?: TripShows,
  { withPlan = true } = {}
) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(bundle)
    if (path === '/trips/trip-1/itinerary')
      // A plan that never arrives is how the grid looks on a slow connection.
      return withPlan ? Promise.resolve({ items }) : new Promise(() => {})
    return Promise.resolve({
      zone: { id: 'zone-1', name: 'Tokyo', name_ja: null, summary: null },
      tips: [],
      files: [],
      place_counts,
    })
  })
  return renderAt(
    '/trips/trip-1/zones/zone-1',
    [{ path: '/trips/:tripId/zones/:zoneId', element: <Zone /> }],
    shows ? { shows } : undefined
  )
}

const card = (category: string) => screen.getByTestId(`category-${category}`)

describe('the Explore grid reads the plan (US1)', () => {
  it('reports what is saved and what is planned', async () => {
    renderZone({ ...counts, food: 4 }, [
      item({ category: 'food' }),
      item({ category: 'food', place_id: 'p1' }),
    ])
    expect(await screen.findByTestId('category-food')).toHaveTextContent('4 saved · 2 planned')
  })

  it('says nothing about the plan when nothing is planned', async () => {
    renderZone({ ...counts, food: 4 }, [item({ category: 'attraction' })])
    expect(await screen.findByTestId('category-food')).toHaveTextContent('4 saved')
    expect(card('food')).not.toHaveTextContent('planned')
  })

  it('shows a card for a category that is planned but not saved', async () => {
    // "Whatever the konbini has" — tagged, linked to nothing saved.
    renderZone(counts, [item({ category: 'shopping' })])
    expect(await screen.findByTestId('category-shopping')).toHaveTextContent('0 saved · 1 planned')
  })

  it('draws no card for a category with neither', async () => {
    renderZone({ ...counts, food: 1 }, [item({ category: 'food' })])
    await screen.findByTestId('category-food')
    expect(screen.queryByTestId('category-attraction')).not.toBeInTheDocument()
    expect(screen.queryByTestId('category-hotel')).not.toBeInTheDocument()
  })

  it('counts an activity in the city it is pinned to on a shared day', async () => {
    renderZone({ ...counts, food: 1 }, [
      item({ zone_id: 'zone-1', day: '2026-10-09', category: 'food' }),
      item({ zone_id: 'zone-2', day: '2026-10-09', category: 'food' }),
    ])
    expect(await screen.findByTestId('category-food')).toHaveTextContent('1 saved · 1 planned')
  })

  it('paints the saved counts before the plan has arrived', async () => {
    renderZone({ ...counts, food: 4 }, [], undefined, { withPlan: false })
    expect(await screen.findByTestId('category-food')).toHaveTextContent('4 saved')
    expect(card('food')).not.toHaveTextContent('planned')
  })

  it('grows no Stays card for a member whose view withholds them', async () => {
    // The server already sends them no stay count and no derived stay tag. What
    // it leaves alone is the traveller's own typed one — which alone would put a
    // "0 saved · 1 planned" Stays card on this grid (research R3).
    renderZone(counts, [item({ category: 'hotel', title: 'Check in' })], {
      stays: false,
      flight: true,
      documents: true,
      shopping: true,
    })
    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    expect(screen.queryByTestId('category-hotel')).not.toBeInTheDocument()
  })

  it('shows the Stays card to a member who may see them', async () => {
    renderZone(counts, [item({ category: 'hotel', title: 'Check in' })])
    expect(await screen.findByTestId('category-hotel')).toHaveTextContent('0 saved · 1 planned')
  })
})
