// The trip screen's opening (redesign options 1e/1f).
//
// Two things are worth holding still here. The photo hero is the default for
// every trip, including the Japan one the sushi sequence was drawn for — that
// animation is behind `journey-sushi-hero`, and a flag that defaults off means
// local dev, a deploy without analytics and a phone with no signal all get the
// photo. And the countdown card opens collapsed: the numbers are the whole
// card until someone asks for the rest.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import Journey from '../pages/Journey'
import { renderAt } from './helpers'

const flags = vi.hoisted(() => ({ sushi: false }))
vi.mock('../lib/flags', () => ({
  useBooleanFlag: (key: string, fallback: boolean) =>
    key === 'journey-sushi-hero' ? flags.sushi : fallback,
}))

// GSAP drives the sushi hero off scroll and measures a layout jsdom does not
// have. The point of these tests is which hero is chosen, not how it animates.
vi.mock('../components/SushiSequence', () => ({
  SushiSequence: ({ title }: { title: string }) => <div data-testid="sushi-hero">{title}</div>,
}))

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const bundle = (flight?: unknown) => ({
  trip: {
    id: 'trip-1',
    name: null,
    display_title: 'Yuval and Luciana in Japan',
    country: 'Japan',
    start_date: '2026-09-19',
    end_date: '2026-10-16',
    start_time: null,
    start_tz: null,
    description: null,
    people: [],
    local_currency: 'JPY',
    home_currencies: ['USD'],
  },
  steps: [
    {
      id: 'step-1',
      position: 1,
      start_date: '2026-09-19',
      end_date: '2026-09-25',
      zone: {
        id: 'zone-tokyo',
        name: 'Tokyo',
        image_url: 'https://example.com/tokyo.jpg',
        saved_counts: { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 },
      },
    },
    {
      id: 'step-2',
      position: 2,
      start_date: '2026-09-25',
      end_date: '2026-09-27',
      zone: {
        id: 'zone-hakone',
        name: 'Hakone',
        image_url: null,
        saved_counts: { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 },
      },
    },
  ],
  trip_files_count: 0,
  my_role: 'owner',
  shows: { stays: true, flight: true, documents: true, shopping: true },
  ...(flight ? { flight } : {}),
})

const flight = {
  booking_ref: 'AOXIUF',
  outbound: {
    depart_at: '2026-09-18T15:35:00+03:00',
    depart_tz: 'Asia/Jerusalem',
    legs: [{ flight_no: 'ET 419', from: 'Tel Aviv', to: 'Addis Ababa' }],
  },
}

const route = [{ path: '/trips/:tripId', element: <Journey /> }]

const mockApi = (payload: unknown) =>
  mocks.get.mockImplementation((path: string) =>
    path === '/trips/trip-1'
      ? Promise.resolve(payload)
      : Promise.resolve({ activities: [], items: [] })
  )

beforeEach(() => {
  flags.sushi = false
  vi.clearAllMocks()
})

describe('the trip hero', () => {
  it('opens on a photo of the first stop, captioned with the trip’s span', async () => {
    mockApi(bundle())
    renderAt('/trips/trip-1', route)

    await screen.findByRole('heading', { name: 'Japan' })
    // Nothing on a trip carries a photo of its own, so the hero borrows the
    // city you land in.
    expect(screen.getByRole('img', { name: 'Japan' })).toHaveAttribute(
      'src',
      'https://example.com/tokyo.jpg'
    )
    expect(screen.getByText('Trip overview')).toBeInTheDocument()
    expect(screen.getByText('Sep 19 – Oct 16 · 2 stops')).toBeInTheDocument()
    expect(screen.queryByTestId('sushi-hero')).not.toBeInTheDocument()
  })

  it('falls back to the gradient when the first stop has no photo', async () => {
    const noPhoto = bundle()
    noPhoto.steps[0].zone.image_url = null
    mockApi(noPhoto)
    renderAt('/trips/trip-1', route)

    await screen.findByRole('heading', { name: 'Japan' })
    // ZoneImage renders the warm gradient rather than a broken image.
    expect(screen.queryByRole('img', { name: 'Japan' })).not.toBeInTheDocument()
  })

  it('puts the sushi sequence back when its flag is on', async () => {
    flags.sushi = true
    mockApi(bundle())
    renderAt('/trips/trip-1', route)

    // The animation gets the composed title — it was drawn around the whole
    // sentence, not the short label the photo hero uses.
    expect(await screen.findByTestId('sushi-hero')).toHaveTextContent('Yuval and Luciana in Japan')
    expect(screen.queryByText('Trip overview')).not.toBeInTheDocument()
  })

  it('keeps the photo hero on a trip that is not Japan, flag or no flag', async () => {
    flags.sushi = true
    const lisbon = bundle()
    lisbon.trip.country = 'Portugal'
    lisbon.trip.display_title = 'Yuval and Luciana in Portugal'
    mockApi(lisbon)
    renderAt('/trips/trip-1', route)

    await screen.findByRole('heading', { name: 'Portugal' })
    expect(screen.queryByTestId('sushi-hero')).not.toBeInTheDocument()
  })
})

describe('the countdown card on the trip screen', () => {
  it('shows the numbers and holds the booking behind a tap', async () => {
    mockApi(bundle(flight))
    renderAt('/trips/trip-1', route)

    await screen.findByRole('timer')
    expect(screen.queryByText('AOXIUF')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Tap here to see the flight details'))
    expect(screen.getByText('AOXIUF')).toBeInTheDocument()
    expect(screen.getByText('ET 419')).toBeInTheDocument()
  })
})
