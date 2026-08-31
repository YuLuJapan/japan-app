// A category list, once it can read the plan (feature 010, US2): the planned
// band above the saved places, and the marker on the ones already on a day.
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { ItineraryItem, PlaceListItem, TripShows } from '../api/types'
import CategoryList from '../pages/CategoryList'
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

const place = (id: string, name: string): PlaceListItem => ({
  id,
  name,
  name_ja: null,
  category: 'food',
  summary_line: '',
  image_url: null,
})

function renderList(places: PlaceListItem[], items: ItineraryItem[], shows?: TripShows) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(bundle)
    if (path === '/trips/trip-1/itinerary') return Promise.resolve({ items })
    if (path.includes('/places')) return Promise.resolve({ places })
    return Promise.resolve({
      zone: { id: 'zone-1', name: 'Tokyo', name_ja: null, summary: null },
      tips: [],
      files: [],
      place_counts: counts,
    })
  })
  return renderAt(
    '/trips/trip-1/zones/zone-1/c/food',
    [{ path: '/trips/:tripId/zones/:zoneId/c/:category', element: <CategoryList /> }],
    shows ? { shows } : undefined
  )
}

describe('the category list shows the plan beside the saved places (US2)', () => {
  it('puts the planned band above the saved places, each under its own heading', async () => {
    renderList([place('p1', 'Ramen Bar')], [item({ category: 'food', title: 'Konbini dinner' })])

    const band = await screen.findByTestId('planned-band')
    expect(within(band).getByText('On the plan')).toBeInTheDocument()
    expect(within(band).getByText('Konbini dinner')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
    // The planned band is not the saved list: the activity is not a place card.
    expect(within(band).queryByText('Ramen Bar')).not.toBeInTheDocument()
  })

  it('names the day and the time, or says the activity is at no particular one', async () => {
    renderList(
      [],
      [
        item({ category: 'food', day: '2026-10-08', start_time: '19:00', title: 'Dinner' }),
        item({ category: 'food', day: '2026-10-08', start_time: null, title: 'Coffee' }),
      ]
    )

    const band = await screen.findByTestId('planned-band')
    expect(within(band).getByText(/Thu, Oct 8 · 7:00 PM/)).toBeInTheDocument()
    expect(within(band).getByText(/Thu, Oct 8 · Anytime/)).toBeInTheDocument()
  })

  it('opens the place when the activity links to one, and the city when it does not', async () => {
    renderList(
      [place('p1', 'Ramen Bar')],
      [
        item({ category: 'food', place_id: 'p1', title: 'Dinner at the ramen bar' }),
        item({ category: 'food', title: 'Konbini dinner' }),
      ]
    )

    const band = await screen.findByTestId('planned-band')
    expect(within(band).getByRole('link', { name: /Dinner at the ramen bar/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/places/p1'
    )
    expect(within(band).getByRole('link', { name: /Konbini dinner/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/zones/zone-1'
    )
  })

  it('marks a saved place that is on the plan, and counts the rest', async () => {
    renderList(
      [place('p1', 'Ramen Bar'), place('p2', 'Coffee stand')],
      [
        item({ category: 'food', place_id: 'p1', day: '2026-10-06', title: 'Lunch' }),
        item({ category: 'food', place_id: 'p1', day: '2026-10-08', title: 'Again' }),
      ]
    )

    expect(await screen.findByText('Planned Tue, Oct 6 + 1 more')).toBeInTheDocument()
    // The place nothing links to says nothing.
    const rows = screen.getAllByRole('listitem')
    const coffee = rows.find((r) => within(r).queryByText('Coffee stand'))
    expect(coffee && within(coffee).queryByText(/Planned/)).toBeFalsy()
  })

  it('keeps the planned band when nothing is saved, rather than reading as empty', async () => {
    renderList([], [item({ category: 'food', title: 'Konbini dinner' })])

    expect(await screen.findByTestId('planned-band')).toBeInTheDocument()
    expect(screen.getByText('Nothing saved under food & cafés here yet.')).toBeInTheDocument()
  })

  it('reads exactly as before when nothing is planned', async () => {
    renderList([place('p1', 'Ramen Bar')], [item({ category: 'attraction' })])

    expect(await screen.findByText('Ramen Bar')).toBeInTheDocument()
    expect(screen.queryByTestId('planned-band')).not.toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.queryByText(/Planned/)).not.toBeInTheDocument()
  })
})

describe('a member whose view withholds stays', () => {
  it('is shown no planned stay and no marker', async () => {
    mocks.get.mockImplementation((path: string) => {
      if (path === '/trips/trip-1') return Promise.resolve(bundle)
      if (path === '/trips/trip-1/itinerary')
        // The server has already cut the link; the typed tag is all that is left.
        return Promise.resolve({
          items: [item({ category: 'hotel', place_id: null, title: 'Check into the ryokan' })],
        })
      if (path.includes('/places')) return Promise.resolve({ places: [] })
      return Promise.resolve({
        zone: { id: 'zone-1', name: 'Tokyo', name_ja: null, summary: null },
        tips: [],
        files: [],
        place_counts: counts,
      })
    })
    renderAt(
      '/trips/trip-1/zones/zone-1/c/hotel',
      [{ path: '/trips/:tripId/zones/:zoneId/c/:category', element: <CategoryList /> }],
      { shows: { stays: false, flight: true, documents: true, shopping: true } }
    )

    expect(await screen.findByText('The travellers keep the stays private.')).toBeInTheDocument()
    expect(screen.queryByTestId('planned-band')).not.toBeInTheDocument()
    expect(screen.queryByText('Check into the ryokan')).not.toBeInTheDocument()
  })
})
