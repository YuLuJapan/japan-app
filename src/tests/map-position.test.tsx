// "You are here", and the two ways it can be refused.
//
// The rule this file protects hardest is FR-023's first half: **the map never
// asks for a position on mount.** A screen that prompts on arrival trains
// people to refuse, and a refusal cannot be un-refused from inside the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TripMap from '../pages/TripMap'
import { CATEGORY_META, type Category } from '../api/types'
import { renderAt } from './helpers'
import { lastFakeEngine, resetFakeEngine } from '../map/engine.fake'

vi.mock('../map/engine.leaflet', async () => await import('../map/engine.fake'))
vi.mock('../lib/flags', () => ({ useBooleanFlag: () => true }))

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

// A chip is named by `CATEGORY_META`, and these read it rather than repeating
// it: the labels are copy that other features legitimately reword — the
// redesign has already changed one of them once — and a test that hard-codes
// them fails on a rename that broke nothing.
const chip = (category: Category) => ({ name: CATEGORY_META[category].label })

const TOKYO = { id: 'zone-tokyo', name: 'Tokyo', image_url: null, lat: 35.68, lng: 139.76 }

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
    { id: 'step-1', start_date: '2026-10-05', end_date: '2026-10-09', position: 1, zone: TOKYO },
  ],
  trip_files_count: 0,
  my_role: 'owner',
  shows: { stays: true, flight: true, documents: true, shopping: true },
})

const places = [
  {
    id: 'p-ramen',
    name: 'Ramen Bar',
    name_ja: null,
    category: 'food',
    summary_line: '',
    image_url: null,
    address: 'Shinjuku',
    lat: 35.69,
    lng: 139.7,
  },
  {
    id: 'p-teamlab',
    name: 'teamLab',
    name_ja: null,
    category: 'attraction',
    summary_line: '',
    image_url: null,
    address: 'Toyosu',
    lat: 35.63,
    lng: 139.79,
  },
]

const getCurrentPosition = vi.fn()

beforeEach(() => {
  resetFakeEngine()
  getCurrentPosition.mockReset()
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } })
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(bundle())
    if (path.startsWith('/trips/trip-1/zones/zone-tokyo/places')) return Promise.resolve({ places })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
})

afterEach(() => {
  mocks.get.mockReset()
  vi.unstubAllGlobals()
})

const openMap = async () => {
  renderAt('/trips/trip-1/map', [{ path: '/trips/:tripId/map', element: <TripMap /> }])
  await waitFor(() => expect(lastFakeEngine()?.pins).toHaveLength(2))
  return lastFakeEngine()!
}

const grant = (lat: number, lng: number) =>
  getCurrentPosition.mockImplementation((ok: PositionCallback) =>
    ok({ coords: { latitude: lat, longitude: lng, accuracy: 20 } } as GeolocationPosition)
  )

describe('before anyone asks', () => {
  it('never requests a position on mount (FR-023)', async () => {
    const engine = await openMap()
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(engine.self).toBeNull()
  })
})

describe('when the traveller grants it', () => {
  it('marks the position and moves the map to it', async () => {
    grant(35.66, 139.73)
    const engine = await openMap()
    await userEvent.click(screen.getByRole('button', { name: 'Show my position' }))
    await waitFor(() => expect(engine.self).toEqual({ lat: 35.66, lng: 139.73, accuracy: 20 }))
    expect(engine.pans.at(-1)).toMatchObject({ lat: 35.66, lng: 139.73 })
  })

  it('widens the frame for a position near the saved places', async () => {
    grant(35.7, 139.66)
    const engine = await openMap()
    await userEvent.click(screen.getByRole('button', { name: 'Show my position' }))
    await waitFor(() =>
      expect(engine.fitted).toEqual({
        south: 35.63,
        west: 139.66,
        north: 35.7,
        east: 139.79,
      })
    )
  })

  it('leaves the frame alone for a position far away (FR-025)', async () => {
    // Tel Aviv, while the trip is in Tokyo. Zooming out to span both shows
    // neither; the saved places stay the subject and the button is the way to
    // go and look at yourself.
    grant(32.08, 34.78)
    const engine = await openMap()
    const framed = engine.fitted
    await userEvent.click(screen.getByRole('button', { name: 'Show my position' }))
    await waitFor(() => expect(engine.self).not.toBeNull())
    expect(engine.fitted).toEqual(framed)
    // It still moved there when asked — that is what the button is for.
    expect(engine.pans.at(-1)).toMatchObject({ lat: 32.08, lng: 34.78 })
  })
})

describe('when it is refused', () => {
  it('states it plainly, leaves every pin and filter working, and does not ask again', async () => {
    getCurrentPosition.mockImplementation((_ok: PositionCallback, fail: PositionErrorCallback) =>
      fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError)
    )
    const engine = await openMap()
    await userEvent.click(screen.getByRole('button', { name: 'Show my position' }))
    expect(await screen.findByText(/Location is off for this site/)).toBeInTheDocument()
    expect(engine.pins).toHaveLength(2)

    // The chips still filter — a refused position is not a broken screen.
    await userEvent.click(screen.getByRole('button', chip('food')))
    await waitFor(() => expect(engine.pins).toHaveLength(1))

    // And tapping the control again does not re-prompt within the visit.
    await userEvent.click(screen.getByRole('button', { name: 'Show my position' }))
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('says a timeout is unavailable rather than refused', async () => {
    getCurrentPosition.mockImplementation((_ok: PositionCallback, fail: PositionErrorCallback) =>
      fail({ code: 3, PERMISSION_DENIED: 1 } as GeolocationPositionError)
    )
    await openMap()
    await userEvent.click(screen.getByRole('button', { name: 'Show my position' }))
    expect(await screen.findByText(/position is unavailable on this device/)).toBeInTheDocument()
  })
})
