// Two scales on one screen, and the city the map opens on.
//
// The trip spans about 500km, so the whole-trip view is one pin per city and
// **never individual places** (FR-008): at a zoom that fits the trip on a
// phone, every place in a city lands within a few pixels of every other. Every
// saved place stays two taps away — city, then place — which is what the tap
// test below is really checking.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TripMap from '../pages/TripMap'
import { renderAt } from './helpers'
import { lastFakeEngine, resetFakeEngine } from '../map/engine.fake'

vi.mock('../map/engine.leaflet', async () => await import('../map/engine.fake'))
vi.mock('../lib/flags', () => ({ useBooleanFlag: () => true }))

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const counts = (n: number) => ({ hotel: 0, attraction: n, food: 0, shopping: 0, other: 0 })

const zone = (id: string, name: string, lat: number, lng: number, saved: number) => ({
  id,
  name,
  name_ja: null,
  summary: null,
  image_url: null,
  lat,
  lng,
  place_counts: counts(saved),
})

const TOKYO = zone('zone-tokyo', 'Tokyo', 35.68, 139.76, 4)
const KYOTO = zone('zone-kyoto', 'Kyoto', 35.01, 135.76, 3)

const bundle = () => ({
  trip: {
    id: 'trip-1',
    name: 'Test Trip',
    display_title: 'Test Trip',
    country: 'Japan',
    start_date: '2026-10-01',
    end_date: '2026-10-14',
    start_time: null,
    start_tz: null,
    description: null,
    people: [],
    local_currency: 'JPY',
    home_currencies: ['USD'],
  },
  steps: [
    { id: 's1', start_date: '2026-10-01', end_date: '2026-10-08', position: 1, zone: TOKYO },
    { id: 's2', start_date: '2026-10-08', end_date: '2026-10-14', position: 2, zone: KYOTO },
  ],
  trip_files_count: 0,
  my_role: 'owner',
  shows: { stays: true, flight: true, documents: true, shopping: true },
})

const place = (id: string, name: string, lat: number, lng: number) => ({
  id,
  name,
  name_ja: null,
  category: 'attraction',
  summary_line: '',
  image_url: null,
  address: null,
  lat,
  lng,
})

beforeEach(() => {
  resetFakeEngine()
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(bundle())
    if (path.startsWith('/trips/trip-1/zones/zone-tokyo/places'))
      return Promise.resolve({ places: [place('p-teamlab', 'teamLab', 35.63, 139.79)] })
    if (path.startsWith('/trips/trip-1/zones/zone-kyoto/places'))
      return Promise.resolve({ places: [place('p-inari', 'Fushimi Inari', 34.96, 135.77)] })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
})

afterEach(() => {
  mocks.get.mockReset()
  vi.useRealTimers()
})

/** Render with the clock parked on a given day, so "current step" is decidable. */
const openMapOn = async (day: string) => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(`${day}T09:00:00`))
  renderAt('/trips/trip-1/map', [{ path: '/trips/:tripId/map', element: <TripMap /> }])
  await waitFor(() => expect(lastFakeEngine()?.mounted).toBe(true))
  return lastFakeEngine()!
}

describe('opening the map', () => {
  it('opens on the current step’s zone, not on the whole trip (FR-008)', async () => {
    const engine = await openMapOn('2026-10-10')
    await waitFor(() => expect(engine.pins.map((p) => p.id)).toEqual(['p-inari']))
    expect(await screen.findByText('Fushimi Inari')).toBeInTheDocument()
  })

  it('opens on the next step’s zone before the trip starts', async () => {
    const engine = await openMapOn('2026-09-15')
    await waitFor(() => expect(engine.pins.map((p) => p.id)).toEqual(['p-teamlab']))
  })
})

describe('the whole-trip view', () => {
  it('shows one pin per city, each carrying how much is saved there', async () => {
    const engine = await openMapOn('2026-10-10')
    await waitFor(() => expect(engine.pins).toHaveLength(1))

    await userEvent.click(screen.getByRole('button', { name: 'Trip' }))

    await waitFor(() => expect(engine.pins).toHaveLength(2))
    expect(engine.pins.map((p) => p.id)).toEqual(['zone-tokyo', 'zone-kyoto'])
    expect(engine.pins.map((p) => p.count)).toEqual([4, 3])
    // Not one pin per place: at trip zoom they would be one unreadable mass.
    expect(engine.pins.some((p) => p.id.startsWith('p-'))).toBe(false)
  })

  it('frames every stop', async () => {
    const engine = await openMapOn('2026-10-10')
    await userEvent.click(screen.getByRole('button', { name: 'Trip' }))
    await waitFor(() =>
      expect(engine.fitted).toEqual({ south: 35.01, west: 135.76, north: 35.68, east: 139.76 })
    )
  })

  it('lists one card per city with its count', async () => {
    await openMapOn('2026-10-10')
    await userEvent.click(screen.getByRole('button', { name: 'Trip' }))
    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    expect(screen.getByText('4 saved')).toBeInTheDocument()
    expect(screen.getByText('3 saved')).toBeInTheDocument()
  })

  it('drops into that city’s places when a city is tapped (FR-009)', async () => {
    const engine = await openMapOn('2026-10-10')
    await userEvent.click(screen.getByRole('button', { name: 'Trip' }))
    await waitFor(() => expect(engine.pins).toHaveLength(2))

    await act(async () => {
      engine.tap('zone-tokyo')
    })

    await waitFor(() => expect(engine.pins.map((p) => p.id)).toEqual(['p-teamlab']))
    // And the toggle has followed, so the traveller is not left on a control
    // that disagrees with the screen.
    expect(screen.getByRole('button', { name: 'City' })).toHaveAttribute('aria-pressed', 'true')
  })
})
