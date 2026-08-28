// What the map cannot show, said out loud.
//
// The requirement this protects is trust: a map that quietly drops the places
// it has no coordinates for turns a data gap into a silent lie, which is worse
// than the gap (US5). So the count is stated on the map itself — under the
// chips, in the sheet's peeking state, not at the end of a row you have to
// scroll sideways to reach.
//
// The arithmetic at the bottom is SC-004, checked in the case where it is
// easiest to get wrong: a zone containing a stay the caller may not see. A
// withheld stay is in neither half, because it was never sent to this device
// at all — which is the point of enforcing FR-016 on the wire.
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

const TOKYO = {
  id: 'zone-tokyo',
  name: 'Tokyo',
  name_ja: null,
  summary: null,
  image_url: null,
  lat: 35.68,
  lng: 139.76,
  place_counts: { hotel: 1, attraction: 1, food: 1, shopping: 0, other: 0 },
}

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
  steps: [{ id: 's1', start_date: '2026-10-01', end_date: '2026-10-14', position: 1, zone: TOKYO }],
  trip_files_count: 0,
  my_role: 'owner',
  shows: { stays: true, flight: true, documents: true, shopping: true },
})

const place = (
  id: string,
  name: string,
  category: string,
  lat: number | null,
  lng: number | null
) => ({
  id,
  name,
  name_ja: null,
  category,
  summary_line: '',
  image_url: null,
  address: null,
  lat,
  lng,
})

let places: ReturnType<typeof place>[]

beforeEach(() => {
  resetFakeEngine()
  places = [
    place('p-teamlab', 'teamLab', 'attraction', 35.63, 139.79),
    place('p-cafe', 'Unlocated Cafe', 'food', null, null),
    place('p-shrine', 'Unlocated Shrine', 'attraction', null, null),
  ]
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(bundle())
    if (path.startsWith('/trips/trip-1/zones/zone-tokyo/places')) return Promise.resolve({ places })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
})

afterEach(() => mocks.get.mockReset())

const openMap = async (role: 'owner' | 'viewer' = 'owner') => {
  renderAt('/trips/trip-1/map', [{ path: '/trips/:tripId/map', element: <TripMap /> }], {
    tripRole: role,
  })
  await waitFor(() => expect(lastFakeEngine()?.mounted).toBe(true))
  return lastFakeEngine()!
}

describe('the count', () => {
  it('is stated on the map, without scrolling anything', async () => {
    await openMap()
    expect(await screen.findByText(/2 places are not on the map/)).toBeInTheDocument()
  })

  it('says nothing at all when everything in view has a location (FR-019.4)', async () => {
    places = [place('p-teamlab', 'teamLab', 'attraction', 35.63, 139.79)]
    await openMap()
    await waitFor(() => expect(lastFakeEngine()!.pins).toHaveLength(1))
    // Not a zero, not an empty line — the absence is the message.
    expect(screen.queryByText(/not on the map/)).toBeNull()
  })

  it('agrees in number with the singular', async () => {
    places = [
      place('p-teamlab', 'teamLab', 'attraction', 35.63, 139.79),
      place('p-cafe', 'Unlocated Cafe', 'food', null, null),
    ]
    await openMap()
    expect(await screen.findByText(/1 place is not on the map/)).toBeInTheDocument()
  })
})

describe('for a member who can edit', () => {
  it('lists exactly the places lacking coordinates, and routes each to its edit screen', async () => {
    await openMap()
    await userEvent.click(await screen.findByRole('button', { name: /not on the map/ }))

    expect(screen.getByRole('link', { name: /Unlocated Cafe/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/places/p-cafe/edit'
    )
    expect(screen.getByRole('link', { name: /Unlocated Shrine/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/places/p-shrine/edit'
    )
    // Exactly those: the located place is on the map, not on this list.
    expect(screen.queryByRole('link', { name: /teamLab/ })).toBeNull()
  })
})

describe('for a member who cannot edit', () => {
  it('states the same count and offers no action that would be refused (FR-021)', async () => {
    await openMap('viewer')
    expect(await screen.findByText(/2 places are not on the map/)).toBeInTheDocument()
    // Stated honestly, leading nowhere — not hidden, and not a button that
    // would take them to a form they cannot save.
    expect(screen.queryByRole('button', { name: /not on the map/ })).toBeNull()
  })
})

describe('the arithmetic that proves the map is not under-reporting (SC-004)', () => {
  it('holds in a zone containing a stay this member may not see', async () => {
    // What the server sent: the hotel is absent from the payload entirely,
    // because `listZonePlaces` filtered it before the response was built. So
    // "what this member can see" is three, not four.
    places = [
      place('p-teamlab', 'teamLab', 'attraction', 35.63, 139.79),
      place('p-cafe', 'Unlocated Cafe', 'food', null, null),
      place('p-shrine', 'Unlocated Shrine', 'attraction', null, null),
    ]
    await openMap('viewer')
    const engine = lastFakeEngine()!
    await waitFor(() => expect(engine.pins).toHaveLength(1))
    expect(await screen.findByText(/2 places are not on the map/)).toBeInTheDocument()
    expect(engine.pins.length + 2).toBe(places.length)
    // And the withheld stay is in neither half — it was never transmitted, so
    // there is nothing on this device to pin or to count.
    expect(screen.queryByText(/Test Hotel/)).toBeNull()
  })

  it('still holds once a category is filtered out', async () => {
    await openMap()
    const engine = lastFakeEngine()!
    await waitFor(() => expect(engine.pins).toHaveLength(1))
    // Turning off Food leaves one pin (teamLab) and one unlocated attraction.
    await userEvent.click(screen.getByRole('button', chip('food')))
    expect(await screen.findByText(/1 place is not on the map/)).toBeInTheDocument()
    expect(engine.pins).toHaveLength(1)
  })
})
