// The map screen, driven against the fake engine.
//
// jsdom has no layout, so a real Leaflet map cannot mount in one — which is
// exactly why `MapEngine` exists (contracts §5). Mocking `engine.leaflet` with
// `engine.fake` is not a workaround for a testing limitation; it is the port
// doing the job it was built for, and every assertion below is about what the
// page *asked* the engine to draw rather than about pixels.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TripMap from '../pages/TripMap'
import { CATEGORY_META, type Category } from '../api/types'
import { renderAt, activity } from './helpers'
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

const place = (
  id: string,
  name: string,
  category: string,
  lat: number | null,
  lng: number | null
) =>
  activity({
    id,
    name,
    category: category as Category,
    address: `${name} street`,
    lat,
    lng,
    zone_id: 'zone-tokyo',
  })

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

let places: ReturnType<typeof place>[]

beforeEach(() => {
  resetFakeEngine()
  places = [
    place('p-ramen', 'Ramen Bar', 'food', 35.69, 139.7),
    place('p-teamlab', 'teamLab', 'attraction', 35.63, 139.79),
    place('p-nowhere', 'Unlocated Cafe', 'food', null, null),
  ]
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(bundle())
    if (path === '/trips/trip-1/activities') return Promise.resolve({ activities: places })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
})

afterEach(() => {
  mocks.get.mockReset()
  vi.unstubAllGlobals()
})

// The map now opens on the trip view by default, so a suite about the city
// scale switches into it first.
const openMap = async () => {
  renderAt('/trips/trip-1/map', [{ path: '/trips/:tripId/map', element: <TripMap /> }])
  await waitFor(() => expect(lastFakeEngine()?.mounted).toBe(true))
  await userEvent.click(screen.getByRole('button', { name: 'City' }))
  return lastFakeEngine()!
}

describe('the zone map', () => {
  it('pins exactly the located places of the zone it opens on', async () => {
    const engine = await openMap()
    await waitFor(() => expect(engine.pins).toHaveLength(2))
    expect(engine.pins.map((p) => p.id)).toEqual(['p-ramen', 'p-teamlab'])
    // The place with no coordinates is not a pin and is not silently dropped —
    // it has no card either, and US5's line is what accounts for it.
    expect(engine.pins.some((p) => p.id === 'p-nowhere')).toBe(false)
  })

  it('frames every pin when it opens', async () => {
    const engine = await openMap()
    await waitFor(() => expect(engine.fitted).not.toBeNull())
    expect(engine.fitted).toEqual({ south: 35.63, west: 139.7, north: 35.69, east: 139.79 })
  })

  it('asks for every category in one request, and filters without another', async () => {
    const engine = await openMap()
    await waitFor(() => expect(engine.pins).toHaveLength(2))
    const before = mocks.get.mock.calls.length
    await userEvent.click(screen.getByRole('button', chip('food')))
    await waitFor(() => expect(engine.pins).toHaveLength(1))
    // Toggling a chip is a client-side filter over the list already fetched
    // (contracts §1) — a request per chip would be a request per thought.
    expect(mocks.get.mock.calls.length).toBe(before)
  })

  it('removes only the toggled category, and puts it back', async () => {
    const engine = await openMap()
    await waitFor(() => expect(engine.pins).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', chip('food')))
    await waitFor(() => expect(engine.pins.map((p) => p.id)).toEqual(['p-teamlab']))
    await userEvent.click(screen.getByRole('button', chip('food')))
    await waitFor(() => expect(engine.pins.map((p) => p.id)).toEqual(['p-ramen', 'p-teamlab']))
  })

  it('offers a chip only for a category present in the view (FR-010)', async () => {
    await openMap()
    expect(await screen.findByRole('button', chip('food'))).toBeInTheDocument()
    expect(screen.getByRole('button', chip('attraction'))).toBeInTheDocument()
    // No stay in this zone, so no Stays chip — the same rule that hides it for
    // a member whose view withholds them.
    expect(screen.queryByRole('button', chip('hotel'))).toBeNull()
  })

  it('says the filters are what emptied it, not the city', async () => {
    // Turning every chip off is a thing a thumb does on the way to picking
    // one. Answering it with "Nothing saved in Tokyo yet" over three saved
    // places reads as lost data rather than as a filter.
    const engine = await openMap()
    await waitFor(() => expect(engine.pins).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', chip('food')))
    await userEvent.click(screen.getByRole('button', chip('attraction')))

    expect(await screen.findByText('Nothing in Tokyo matches these filters.')).toBeInTheDocument()
    expect(engine.pins).toEqual([])
    // And `All` is right above the line, so the way back is one tap.
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(engine.pins).toHaveLength(2))
  })

  it('says so plainly when nothing in the zone has a location', async () => {
    places = [place('p-nowhere', 'Unlocated Cafe', 'food', null, null)]
    const engine = await openMap()
    expect(await screen.findByText(/Nothing saved in Tokyo has a location yet/)).toBeInTheDocument()
    expect(engine.pins).toEqual([])
  })

  it('lists a card per pin, in the order the pins are drawn', async () => {
    await openMap()
    expect(await screen.findByText('Ramen Bar')).toBeInTheDocument()
    expect(screen.getByText('Food spot · Tokyo')).toBeInTheDocument()
    expect(screen.getByText('teamLab')).toBeInTheDocument()
  })
})

describe('the whole-trip view', () => {
  // The chips filter places by category and the legend explains the colours
  // the pins are drawn in. At the trip scale a pin is a *city*: there is
  // nothing to filter and no category colour on the screen, so both would be
  // controls for something that is not there.
  it('offers neither the filters nor the legend, and puts both back on a city', async () => {
    await openMap()
    // At the city scale the label is on screen twice — once as a chip, once as
    // a legend row.
    await waitFor(() => expect(screen.getAllByText(CATEGORY_META.food.label)).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', { name: 'Trip' }))

    await waitFor(() => expect(screen.queryByRole('button', chip('food'))).toBeNull())
    expect(screen.queryAllByText(CATEGORY_META.food.label)).toHaveLength(0)
    expect(screen.queryAllByText(CATEGORY_META.attraction.label)).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'City' }))
    await waitFor(() => expect(screen.getAllByText(CATEGORY_META.food.label)).toHaveLength(2))
  })
})

describe('with no connection', () => {
  it('lists the places and says why the map is not drawn, rather than showing a grey square', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false })
    renderAt('/trips/trip-1/map', [{ path: '/trips/:tripId/map', element: <TripMap /> }])
    expect(await screen.findByText(/The map needs a connection/)).toBeInTheDocument()
    // The scale toggle is client state, so it still works with no connection —
    // switching into the city, whose places are still local (TanStack Query's
    // cache holds the zone response), is a screenful of them, not an apology.
    await userEvent.click(screen.getByRole('button', { name: 'City' }))
    expect(await screen.findByText('Ramen Bar')).toBeInTheDocument()
    expect(screen.getByText('teamLab')).toBeInTheDocument()
    // And no engine was ever asked to mount.
    expect(lastFakeEngine()).toBeNull()
  })
})
