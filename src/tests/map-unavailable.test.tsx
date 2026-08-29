// When the map's own engine will not arrive.
//
// Leaflet is one of the few things deliberately kept out of the precache (the
// OSM tile policy forbids bulk pre-fetching, and an engine whose imagery
// cannot come with it buys install weight and no offline capability), so it
// **always** comes from the network. That makes this the most likely dynamic
// import in the app to fail, and there are two quite different reasons it
// might — which used to be one sentence, and the wrong one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import TripMap from '../pages/TripMap'
import { renderAt } from './helpers'
import { lastFakeEngine, resetFakeEngine } from '../map/engine.fake'

// The 404 a page one deploy behind gets, in Chrome's words.
const MISSING = 'Failed to fetch dynamically imported module: /assets/engine.leaflet-B4_.js'

// Thrown from the export rather than from the factory: a factory that throws
// is reported by Vitest as its own "error when mocking a module", which is not
// the message a browser gives and not the one the code reads. A getter puts
// the real wording on the same rejection the real failure produces — the
// `.then` that destructures `createEngine` throws, and the same `.catch`
// handles it.
vi.mock('../map/engine.leaflet', () => ({
  get createEngine(): never {
    throw new Error(MISSING)
  },
}))
vi.mock('../lib/flags', () => ({ useBooleanFlag: () => true }))

const reload = vi.hoisted(() => vi.fn())
vi.mock('../lib/reload', () => ({ reloadPage: reload }))

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

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
    address: null,
    lat: 35.69,
    lng: 139.7,
  },
]

beforeEach(() => {
  resetFakeEngine()
  reload.mockReset()
  sessionStorage.clear()
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

const openMap = () =>
  renderAt('/trips/trip-1/map', [{ path: '/trips/:tripId/map', element: <TripMap /> }])

describe('with no connection', () => {
  beforeEach(() => vi.stubGlobal('navigator', { ...navigator, onLine: false }))

  it('lists the places and says why the map is not drawn, rather than showing a grey square', async () => {
    openMap()
    expect(await screen.findByText(/The map needs a connection/)).toBeInTheDocument()
    // The places are still local — TanStack Query's cache holds the zone
    // response — so the answer is a screenful of them, not an apology.
    expect(await screen.findByText('Ramen Bar')).toBeInTheDocument()
    expect(lastFakeEngine()).toBeNull()
  })

  it('does not spend the one reload on a network that is simply not there', async () => {
    // It would fail the same way and take the attempt a genuinely stale page
    // needs with it.
    openMap()
    await screen.findByText(/The map needs a connection/)
    expect(reload).not.toHaveBeenCalled()
  })

  it('still tries: `navigator.onLine` is not trusted to refuse on its own', async () => {
    // An installed iOS PWA reports `false` while perfectly online often enough
    // that gating on it made the map simply refuse to draw. The import is
    // attempted and decides.
    openMap()
    await screen.findByText(/The map needs a connection/)
    expect(mocks.get).toHaveBeenCalled()
  })
})

describe('with a connection, and a chunk that is a deploy behind', () => {
  it('reloads once rather than blaming the traveller’s signal', async () => {
    openMap()
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    // Nothing about connections is said: this page is on its way out.
    expect(screen.queryByText(/needs a connection/)).toBeNull()
  })

  it('says what actually happened once the reload has been spent', async () => {
    sessionStorage.setItem('onward:chunk-reload', String(Date.now()))
    openMap()

    expect(await screen.findByText(/The map could not be loaded/)).toBeInTheDocument()
    // Not this: they have four bars, and sending them to look for signal is
    // the bug.
    expect(screen.queryByText(/needs a connection/)).toBeNull()
    expect(reload).not.toHaveBeenCalled()
    // And the places are still the answer, exactly as when offline.
    expect(await screen.findByText('Ramen Bar')).toBeInTheDocument()
  })
})
