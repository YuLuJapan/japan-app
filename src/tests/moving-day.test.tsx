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
import { renderAt, activity } from './helpers'

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
  saved_counts: counts,
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

const item = (id: string, zoneId: string | null, time: string, title: string) =>
  activity({ id, zone_id: zoneId, day: '2026-09-25', start_time: time, name: title })

const ITEMS = [
  item('i1', 'z-tokyo', '09:00', 'teamLab before the train'),
  item('i2', 'z-hakone', '16:00', 'Onsen on arrival'),
]

/** Legacy rows: the morning is pinned to no city at all. */
let LOOSE_MORNING = false

function mockApi(zoneId: string, name: string) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(TRIP_BUNDLE)
    if (path === '/trips/trip-1/activities')
      return Promise.resolve({
        activities: LOOSE_MORNING ? [{ ...ITEMS[0], zone_id: null }, ITEMS[1]] : ITEMS,
      })
    if (path === `/trips/trip-1/zones/${zoneId}`)
      return Promise.resolve({
        zone: { id: zoneId, name, name_ja: null, summary: null },
        tips: [],
        files: [],
        saved_counts: counts,
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

  it('shows the whole day, a city at a time, each under its own name', () => {
    renderTrip()

    // Both halves, each under the city it is in.
    const bands = screen.getAllByTestId('day-band')
    expect(bands.map((b) => b.textContent)).toEqual([
      'Earlier that day, in Tokyo',
      'Later that day, in Hakone',
    ])
    expect(screen.getByText('teamLab before the train')).toBeInTheDocument()
    expect(screen.getByText('Onsen on arrival')).toBeInTheDocument()

    // Order on the page: Tokyo and its morning, then Hakone and its afternoon.
    // The second heading is the only marker the move needs.
    // `children` leads with the rail's own <span>, so read the order rather than
    // the indices: each city's heading sits directly above its own activity.
    const rows = [...screen.getByRole('list').children].map((el) => el.textContent ?? '')
    const at = (needle: string) => rows.findIndex((t) => t.includes(needle))
    expect([at('teamLab'), at('Later that day'), at('Onsen')]).toEqual([
      at('Earlier that day') + 1,
      at('Earlier that day') + 2,
      at('Earlier that day') + 3,
    ])
  })

  it('leaves an ordinary day unbanded', () => {
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
  })
})
