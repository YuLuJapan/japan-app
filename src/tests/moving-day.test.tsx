// A moving day (Tokyo → Hakone on the 25th) belongs to both cities: you're still
// out in the first one that morning. It must show up — flagged — on both pages.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const zone = (id: string, name: string) => ({
  id,
  name,
  name_ja: null,
  summary: null,
  place_counts: counts,
})

const TOKYO = zone('z-tokyo', 'Tokyo')
const HAKONE = zone('z-hakone', 'Hakone')

const TRIP_BUNDLE = {
  trip: {
    id: 'trip-1',
    name: 'Japan',
    country: 'Japan',
    display_title: 'Japan',
    start_date: '2026-09-23',
    end_date: '2026-09-27',
    description: null,
    people: [],
  },
  steps: [
    { id: 's1', position: 1, start_date: '2026-09-23', end_date: '2026-09-25', zone: TOKYO },
    { id: 's2', position: 2, start_date: '2026-09-25', end_date: '2026-09-27', zone: HAKONE },
  ],
  trip_files_count: 0,
  flight: null,
}

const ITEMS = [
  {
    id: 'i1',
    trip_id: 'trip-1',
    zone_id: 'z-tokyo',
    place_id: null,
    day: '2026-09-25',
    start_time: '09:00',
    title: 'teamLab before the train',
    note: null,
    position: 0,
    highlight: false,
    icon: null,
  },
]

function mockApi(zoneId: string, name: string) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(TRIP_BUNDLE)
    if (path === '/trips/trip-1/itinerary') return Promise.resolve({ items: ITEMS })
    if (path === `/trips/trip-1/zones/${zoneId}`)
      return Promise.resolve({
        zone: { id: zoneId, name, name_ja: null, summary: null },
        tips: [],
        files: [],
        place_counts: counts,
      })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

const renderZone = (zoneId: string) =>
  renderAt(`/trips/trip-1/zones/${zoneId}`, [
    { path: '/trips/:tripId/zones/:zoneId', element: <Zone /> },
  ])

describe('moving days on a city page', () => {
  it('shows the checkout day on the city being left, flagged with where it goes', async () => {
    mockApi('z-tokyo', 'Tokyo')
    const user = userEvent.setup()
    renderZone('z-tokyo')

    // Sep 25 is Tokyo's last morning — it used to be missing from this strip entirely.
    const chip = await screen.findByLabelText('2026-09-25 (moving day)')
    await user.click(chip)

    // The badge is gone; the cities either side are what says it now.
    expect(screen.getByTestId('moving-day-cities')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '→ Hakone' })).toHaveAttribute(
      'href',
      '/trips/trip-1/zones/z-hakone'
    )
    // things still planned in Tokyo that morning are listed
    expect(screen.getByText('teamLab before the train')).toBeInTheDocument()
  })

  it('shows the same day on the arrival city, pointing back where it came from', async () => {
    mockApi('z-hakone', 'Hakone')
    renderZone('z-hakone')

    expect(await screen.findByLabelText('2026-09-25 (moving day)')).toBeInTheDocument()
    expect(screen.getByTestId('moving-day-cities')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tokyo →' })).toHaveAttribute(
      'href',
      '/trips/trip-1/zones/z-tokyo'
    )
    // the Tokyo-pinned morning activity stays out of Hakone's plan
    expect(screen.queryByText('teamLab before the train')).not.toBeInTheDocument()
  })

  it('leaves a day spent wholly in one city unflagged', async () => {
    mockApi('z-tokyo', 'Tokyo')
    const user = userEvent.setup()
    renderZone('z-tokyo')

    await user.click(await screen.findByLabelText('2026-09-24'))
    expect(screen.queryByTestId('moving-day-cities')).not.toBeInTheDocument()
  })
})
