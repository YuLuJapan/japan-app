// Pin → place → directions, and the two-tap budget it has to fit in (SC-008).
//
// There is **no second sheet**. 2a already has one, so an overlay for a tapped
// pin would cover the thing it was opened from (research R13). Tapping a pin
// scrolls the card row to that place and expands its card — one sheet, two
// states — which also means the summary is rendered from the list the screen
// already fetched rather than from a second request for a place it has.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
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
    summary_line: 'Tonkotsu, open late',
    image_url: null,
    address: '1-22-7 Jinnan',
    lat: 35.69,
    lng: 139.7,
  },
  {
    id: 'p-teamlab',
    name: 'teamLab',
    name_ja: null,
    category: 'attraction',
    summary_line: 'Book ahead',
    image_url: null,
    address: 'Toyosu',
    lat: 35.63,
    lng: 139.79,
  },
]

beforeEach(() => {
  resetFakeEngine()
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(bundle())
    if (path.startsWith('/trips/trip-1/zones/zone-tokyo/places')) return Promise.resolve({ places })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
})

afterEach(() => mocks.get.mockReset())

const openMap = async () => {
  renderAt('/trips/trip-1/map', [{ path: '/trips/:tripId/map', element: <TripMap /> }])
  await waitFor(() => expect(lastFakeEngine()?.pins).toHaveLength(2))
  return lastFakeEngine()!
}

const card = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement

/** A finger on a marker: the engine's handler, driven from outside React. */
const tapPin = (engine: { tap: (id: string) => void }, id: string) =>
  act(() => {
    engine.tap(id)
  })

describe('tapping a pin', () => {
  it("expands that place's card into its summary and both ways out", async () => {
    const engine = await openMap()
    const requests = mocks.get.mock.calls.length

    await tapPin(engine, 'p-ramen')

    const expanded = await waitFor(() => {
      const el = card('p-ramen')
      expect(within(el).getByText('1-22-7 Jinnan')).toBeInTheDocument()
      return el
    })
    expect(within(expanded).getByText('Tonkotsu, open late')).toBeInTheDocument()
    expect(within(expanded).getByText('Food spot')).toBeInTheDocument()

    // It renders what the list already returned — no second fetch for a place
    // the screen is holding.
    expect(mocks.get.mock.calls.length).toBe(requests)
  })

  it('points both links at that place', async () => {
    const engine = await openMap()
    await tapPin(engine, 'p-ramen')
    const expanded = await waitFor(() => {
      const el = card('p-ramen')
      expect(within(el).getByRole('link', { name: 'Open place' })).toBeInTheDocument()
      return el
    })
    expect(within(expanded).getByRole('link', { name: 'Open place' })).toHaveAttribute(
      'href',
      '/trips/trip-1/places/p-ramen'
    )
    // A destination, not a search: directions in one more tap is the whole
    // point of a separate link (SC-008).
    expect(within(expanded).getByRole('link', { name: 'Directions' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=35.69%2C139.7'
    )
  })

  it('expands one card at a time', async () => {
    const engine = await openMap()
    await tapPin(engine, 'p-ramen')
    await waitFor(() => expect(within(card('p-ramen')).getByText('1-22-7 Jinnan')).toBeTruthy())
    await tapPin(engine, 'p-teamlab')
    await waitFor(() => expect(within(card('p-teamlab')).getByText('Toyosu')).toBeTruthy())
    expect(within(card('p-ramen')).queryByText('1-22-7 Jinnan')).toBeNull()
  })

  it('leaves the map where it was — the pins are neither refitted nor redrawn', async () => {
    const engine = await openMap()
    const framed = engine.fitted
    const drawn = engine.pins
    await tapPin(engine, 'p-ramen')
    await waitFor(() => expect(within(card('p-ramen')).getByText('1-22-7 Jinnan')).toBeTruthy())
    expect(engine.fitted).toEqual(framed)
    // Same array, not merely equal: expanding a card must not cost a redraw of
    // every marker on screen.
    expect(engine.pins).toBe(drawn)
  })
})

describe('tapping a card', () => {
  it('selects it the same way a pin does, so the two stay in step', async () => {
    await openMap()
    await userEvent.click(screen.getByRole('button', { name: /teamLab/ }))
    await waitFor(() => expect(within(card('p-teamlab')).getByText('Toyosu')).toBeTruthy())
  })

  it('centres the map on the place, without reframing it', async () => {
    // A card scrolled to from the row can be a place the frame does not
    // contain, and expanding its card says nothing about where it is. The map
    // moves to it; it does not refit, so the scale the traveller chose stays.
    const engine = await openMap()
    const framed = engine.fitted

    await userEvent.click(screen.getByRole('button', { name: /teamLab/ }))

    await waitFor(() => expect(engine.pans).toHaveLength(1))
    expect(engine.pans[0]).toEqual({ lat: 35.63, lng: 139.79, zoom: undefined })
    expect(engine.fitted).toEqual(framed)
  })

  it('centres on a tapped pin too, so both routes to a place agree', async () => {
    const engine = await openMap()
    await tapPin(engine, 'p-ramen')
    await waitFor(() => expect(engine.pans).toEqual([{ lat: 35.69, lng: 139.7, zoom: undefined }]))
  })
})

describe('the sheet', () => {
  const handle = () => screen.getByRole('separator')

  // jsdom implements no `PointerEvent`, so `fireEvent.pointerMove` falls back
  // to a bare `Event` and drops `clientY` — the one property a drag is made
  // of. A `MouseEvent` under the pointer event's name carries it, and React
  // reads the coordinate off the native event either way.
  const at = (type: string, clientY: number) =>
    new MouseEvent(type, { bubbles: true, cancelable: true, clientY })

  /** A finger on the handle, travelling `by` pixels (negative is upwards). */
  const drag = (by: number) => {
    const grip = handle()
    fireEvent(grip, at('pointerdown', 400))
    fireEvent(grip, at('pointermove', 400 + by))
    fireEvent(grip, at('pointerup', 400 + by))
  }

  it('opens peeking, expands on a drag up and shrinks again on a drag down', async () => {
    await openMap()
    // The sheet exists to be peeked over, so full height is never where it starts.
    expect(handle()).toHaveAccessibleName(/drag up/i)

    drag(-80)
    await waitFor(() => expect(handle()).toHaveAccessibleName(/drag down/i))

    drag(80)
    await waitFor(() => expect(handle()).toHaveAccessibleName(/drag up/i))
  })

  it('is not a tap: a press that goes nowhere leaves the sheet where it was', async () => {
    // The bug this replaces — one undifferentiated tap took the sheet to full
    // height, covering the map the traveller opened the screen for.
    await openMap()
    await userEvent.click(handle())
    expect(handle()).toHaveAccessibleName(/drag up/i)

    // Nor is a jitter a gesture.
    drag(-6)
    expect(handle()).toHaveAccessibleName(/drag up/i)
  })

  it('answers the arrow keys, so the gesture is not the only way', async () => {
    await openMap()
    handle().focus()
    fireEvent.keyDown(handle(), { key: 'ArrowUp' })
    await waitFor(() => expect(handle()).toHaveAccessibleName(/drag down/i))
    fireEvent.keyDown(handle(), { key: 'ArrowDown' })
    await waitFor(() => expect(handle()).toHaveAccessibleName(/drag up/i))
  })
})
