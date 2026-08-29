// A moving day (Tokyo → Hakone on the 25th) belongs to both cities: you're still
// out in the first one that morning. It must show up — flagged — on both pages, and
// so must its plan: the whole day is readable from either end of the move, with the
// other city's half under its own name rather than hidden or silently claimed.
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const item = (id: string, zoneId: string | null, time: string, title: string) => ({
  id,
  trip_id: 'trip-1',
  zone_id: zoneId,
  place_id: null,
  day: '2026-09-25',
  start_time: time,
  title,
  note: null,
  position: 0,
  highlight: false,
  icon: null,
})

const ITEMS = [
  item('i1', 'z-tokyo', '09:00', 'teamLab before the train'),
  item('i2', 'z-hakone', '16:00', 'Onsen on arrival'),
]

/** The reported case: nothing on the moving day is pinned to the city you leave. */
let ALL_IN_HAKONE = false

function mockApi(zoneId: string, name: string) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(TRIP_BUNDLE)
    if (path === '/trips/trip-1/itinerary')
      return Promise.resolve({ items: ALL_IN_HAKONE ? [ITEMS[1]] : ITEMS })
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
  beforeEach(() => {
    ALL_IN_HAKONE = false
  })

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
    // and so is the rest of the day, under the city it is actually in
    expect(screen.getByText('Onsen on arrival')).toBeInTheDocument()
    expect(screen.getByTestId('day-band')).toHaveTextContent('Later that day, in Hakone')
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
    // Hakone's own afternoon needs no heading
    expect(screen.getByText('Onsen on arrival')).toBeInTheDocument()
    // the Tokyo-pinned morning is readable here too, named as Tokyo's
    expect(screen.getByText('teamLab before the train')).toBeInTheDocument()
    expect(screen.getByTestId('day-band')).toHaveTextContent('Earlier that day, in Tokyo')
  })

  it('leaves a day spent wholly in one city unflagged', async () => {
    mockApi('z-tokyo', 'Tokyo')
    const user = userEvent.setup()
    renderZone('z-tokyo')

    await user.click(await screen.findByLabelText('2026-09-24'))
    expect(screen.queryByTestId('moving-day-cities')).not.toBeInTheDocument()
    // one city, one band, no heading
    expect(screen.queryByTestId('day-band')).not.toBeInTheDocument()
  })

  it('is not empty on the city being left when the whole day is pinned to the next one', async () => {
    // The bug as reported: everything added from the trip screen was stamped with the
    // arrival city, so Tokyo's last morning read as "nothing planned for this day".
    ALL_IN_HAKONE = true
    mockApi('z-tokyo', 'Tokyo')
    const user = userEvent.setup()
    renderZone('z-tokyo')

    await user.click(await screen.findByLabelText('2026-09-25 (moving day)'))
    expect(screen.queryByText('Nothing planned for this day yet.')).not.toBeInTheDocument()
    expect(screen.getByText('Onsen on arrival')).toBeInTheDocument()
    expect(screen.getByTestId('day-band')).toHaveTextContent('Later that day, in Hakone')
  })
})
