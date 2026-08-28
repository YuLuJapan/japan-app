// The trip map (redesign option 2c, "City chapters").
//
// What this screen promises today is an arrangement, not a map: the trip's
// stops laid out in space, sized by how much is saved in each, each one opening
// its city. There are no tiles under it yet. So the tests hold the projection
// and the links — the two things a real tile layer underneath must not change.
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import TripMap, { projectStops } from '../pages/TripMap'
import type { TripStep } from '../api/types'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const counts = (n: number) => ({ hotel: n, attraction: 0, food: 0, shopping: 0, other: 0 })

const step = (
  id: string,
  name: string,
  lat: number | null,
  lng: number | null,
  saved: number
): TripStep => ({
  id,
  position: 1,
  start_date: '2026-09-19',
  end_date: '2026-09-25',
  zone: {
    id: `zone-${id}`,
    name,
    name_ja: null,
    summary: null,
    lat,
    lng,
    place_counts: counts(saved),
  },
})

const bundle = (steps: TripStep[]) => ({
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
  steps,
  trip_files_count: 0,
  my_role: 'owner',
  shows: { stays: true, flight: true, documents: true, shopping: true },
})

const render = (steps: TripStep[]) => {
  mocks.get.mockResolvedValue(bundle(steps))
  return renderAt('/trips/trip-1/map', [{ path: '/trips/:tripId/map', element: <TripMap /> }])
}

describe('projectStops', () => {
  it('spreads real coordinates across the field, north at the top', () => {
    const [tokyo, kyoto] = projectStops([
      step('a', 'Tokyo', 35.68, 139.77, 4),
      step('b', 'Kyoto', 35.01, 135.77, 3),
    ])
    // Kyoto is south and west of Tokyo, so it sits lower and further left.
    expect(kyoto.x).toBeLessThan(tokyo.x)
    expect(kyoto.y).toBeGreaterThan(tokyo.y)
  })

  it('keeps every stop inside the padded field', () => {
    for (const p of projectStops([
      step('a', 'Tokyo', 35.68, 139.77, 4),
      step('b', 'Kyoto', 35.01, 135.77, 3),
      step('c', 'Sapporo', 43.06, 141.35, 1),
    ])) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(100)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(100)
    }
  })

  it('spreads stops that were never geocoded instead of stacking them', () => {
    const pts = projectStops([
      step('a', 'Tokyo', null, null, 4),
      step('b', 'Kyoto', null, null, 3),
      step('c', 'Osaka', null, null, 2),
    ])
    // Nothing to project against, so they must at least not land on one point.
    expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(3)
  })

  it('does not collapse when two stops share one city', () => {
    const pts = projectStops([
      step('a', 'Tokyo', 35.68, 139.77, 4),
      step('b', 'Tokyo again', 35.68, 139.77, 1),
    ])
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

describe('the map screen', () => {
  it('draws one cluster per stop, counting what is saved there', async () => {
    render([step('a', 'Tokyo', 35.68, 139.77, 4), step('b', 'Kyoto', 35.01, 135.77, 3)])

    const clusters = await screen.findAllByTestId('map-cluster')
    expect(clusters).toHaveLength(2)
    expect(clusters[0]).toHaveTextContent('Tokyo')
    expect(clusters[0]).toHaveTextContent('4')
    expect(clusters[0]).toHaveAttribute('href', '/trips/trip-1/zones/zone-a')
    expect(clusters[1]).toHaveTextContent('Kyoto')
    expect(clusters[1]).toHaveAttribute('href', '/trips/trip-1/zones/zone-b')
  })

  it('names the country it is showing, and says what a tap does', async () => {
    render([step('a', 'Tokyo', 35.68, 139.77, 4)])

    expect(await screen.findByText('All of Japan')).toBeInTheDocument()
    expect(screen.getByText(/tap a city to open its saved places/i)).toBeInTheDocument()
  })

  it('says so plainly when the trip has no stops yet', async () => {
    render([])

    expect(await screen.findByText(/no stops on this trip yet/i)).toBeInTheDocument()
    expect(screen.queryAllByTestId('map-cluster')).toHaveLength(0)
  })

  it('skips a step whose city could not be resolved rather than drawing a blank', async () => {
    const orphan = { ...step('a', 'Tokyo', 35.68, 139.77, 4), zone: null }
    render([orphan, step('b', 'Kyoto', 35.01, 135.77, 3)])

    const clusters = await screen.findAllByTestId('map-cluster')
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toHaveTextContent('Kyoto')
  })

  it('lists the cities under the field as a second way in', async () => {
    render([step('a', 'Tokyo', 35.68, 139.77, 4), step('b', 'Kyoto', 35.01, 135.77, 3)])

    const field = await screen.findByTestId('map-field')
    const links = within(field).getAllByRole('link', { name: /Kyoto/ })
    // The cluster and the card below it both open the same city.
    expect(links.every((l) => l.getAttribute('href') === '/trips/trip-1/zones/zone-b')).toBe(true)
  })
})
