// A moving day (Tokyo → Hakone on the 25th) belongs to both cities: you're still out
// in the first one that morning. It must show up — flagged — on both pages. Its plan
// does not: a city page shows what you are doing in *that* city, so Tokyo's page has
// the morning and Hakone's has the afternoon. The whole day, both cities at once, is
// what the trip screen is for.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Zone from '../pages/Zone'
import { Schedule } from '../components/Schedule'
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

/** Legacy rows: the morning is pinned to no city at all. */
let LOOSE_MORNING = false

function mockApi(zoneId: string, name: string) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(TRIP_BUNDLE)
    if (path === '/trips/trip-1/itinerary')
      return Promise.resolve({
        items: LOOSE_MORNING ? [{ ...ITEMS[0], zone_id: null }, ITEMS[1]] : ITEMS,
      })
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
    LOOSE_MORNING = false
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
    // the Hakone half is not: this page is Tokyo
    expect(screen.queryByText('Onsen on arrival')).not.toBeInTheDocument()
    expect(screen.queryByTestId('day-band')).not.toBeInTheDocument()
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
    // Hakone's own afternoon, and only that — unbanded, this page is Hakone
    expect(screen.getByText('Onsen on arrival')).toBeInTheDocument()
    expect(screen.queryByText('teamLab before the train')).not.toBeInTheDocument()
    expect(screen.queryByTestId('day-band')).not.toBeInTheDocument()
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

  it('keeps an activity pinned to no city on every city page the day touches', async () => {
    // Rows written before every activity had a city: they belong to the day rather
    // than to one end of it, so neither page drops them.
    LOOSE_MORNING = true
    mockApi('z-hakone', 'Hakone')
    renderZone('z-hakone')

    expect(await screen.findByLabelText('2026-09-25 (moving day)')).toBeInTheDocument()
    expect(screen.getByText('teamLab before the train')).toBeInTheDocument()
  })
})

describe('the same moving day on the trip screen', () => {
  const renderTrip = () => {
    mocks.get.mockImplementation((path: string) =>
      path === '/trips/trip-1'
        ? Promise.resolve(TRIP_BUNDLE)
        : Promise.reject(new Error(`unexpected GET ${path}`))
    )
    return renderAt('/trips/trip-1', [
      {
        path: '/trips/:tripId',
        element: (
          <Schedule
            mode="trip"
            steps={TRIP_BUNDLE.steps}
            items={ITEMS}
            days={['2026-09-25']}
            today="2026-09-25"
            tripId="trip-1"
          />
        ),
      },
    ])
  }

  it('shows the whole day, a city at a time, with the move between them', () => {
    renderTrip()

    // Both halves, each under the city it is in.
    const bands = screen.getAllByTestId('day-band')
    expect(bands.map((b) => b.textContent)).toEqual([
      'Earlier that day, in Tokyo',
      'Later that day, in Hakone',
    ])
    expect(screen.getByText('teamLab before the train')).toBeInTheDocument()
    expect(screen.getByText('Onsen on arrival')).toBeInTheDocument()

    // …and one break, between the two of them, saying what happens there.
    const breaks = screen.getAllByTestId('travel-break')
    expect(breaks).toHaveLength(1)
    expect(breaks[0]).toHaveTextContent('Traveling')

    // Order on the page: Tokyo, the flight, Hakone.
    const rail = screen.getByRole('list')
    const rows = [...rail.children].map((li) => li.textContent ?? '')
    expect(rows.findIndex((t) => t.includes('teamLab'))).toBeLessThan(
      rows.findIndex((t) => t.includes('Traveling'))
    )
    expect(rows.findIndex((t) => t.includes('Traveling'))).toBeLessThan(
      rows.findIndex((t) => t.includes('Onsen'))
    )
  })

  it('leaves an ordinary day unbanded and untravelled', () => {
    mocks.get.mockResolvedValue(TRIP_BUNDLE)
    renderAt('/trips/trip-1', [
      {
        path: '/trips/:tripId',
        element: (
          <Schedule
            mode="trip"
            steps={TRIP_BUNDLE.steps}
            items={[{ ...ITEMS[0], day: '2026-09-24' }]}
            days={['2026-09-24']}
            today="2026-09-24"
            tripId="trip-1"
          />
        ),
      },
    ])

    expect(screen.getByText('teamLab before the train')).toBeInTheDocument()
    expect(screen.queryByTestId('day-band')).not.toBeInTheDocument()
    expect(screen.queryByTestId('travel-break')).not.toBeInTheDocument()
  })
})
