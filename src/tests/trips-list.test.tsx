import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Journey from '../pages/Journey'
import TripsList from '../pages/TripsList'
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

// The common shape since 0015: no name override, so the title is the one the
// server composed from the travellers and the country.
const unnamedTrip = {
  id: 'trip-1',
  name: null,
  country: 'Japan',
  display_title: 'Yuval and Luciana in Japan',
  start_date: '2026-09-18',
  end_date: '2026-10-16',
  description: null,
  people: [{ name: 'Yuval' }, { name: 'Luciana' }],
}

describe('a trip with no name override', () => {
  it('lists under its destination, not the composed sentence', async () => {
    mocks.get.mockResolvedValue({ trips: [unnamedTrip] })
    renderAt('/trips', [{ path: '/trips', element: <TripsList /> }])

    expect(await screen.findByText('Japan')).toBeInTheDocument()
    expect(screen.queryByText('Yuval and Luciana in Japan')).not.toBeInTheDocument()
  })

  it('lists under the name override when there is one', async () => {
    mocks.get.mockResolvedValue({
      trips: [{ ...unnamedTrip, name: 'Honeymoon', display_title: 'Honeymoon' }],
    })
    renderAt('/trips', [{ path: '/trips', element: <TripsList /> }])

    expect(await screen.findByText('Honeymoon')).toBeInTheDocument()
    expect(screen.queryByText('Japan')).not.toBeInTheDocument()
  })

  it('opens on the destination rather than the composed title', async () => {
    mocks.get.mockResolvedValue({ trip: unnamedTrip, steps: [], flight: null })
    renderAt('/trips/trip-1', [{ path: '/trips/:tripId', element: <Journey /> }])

    // The redesign sets the hero in 40px over a photo, so it takes the short
    // label. "Yuval and Luciana in Japan" would wrap to three lines and bury
    // the picture — it is still what the trips list and the export call this
    // trip, and still what the accented HeroTitle renders behind the sushi flag.
    await screen.findByRole('heading', { name: 'Japan' })
    expect(screen.queryByText('Yuval and Luciana in Japan')).not.toBeInTheDocument()
  })

  it('leaves a name override plain — there is no country at its tail to accent', async () => {
    mocks.get.mockResolvedValue({
      trip: { ...unnamedTrip, name: 'Honeymoon', display_title: 'Honeymoon' },
      steps: [],
      flight: null,
    })
    renderAt('/trips/trip-1', [{ path: '/trips/:tripId', element: <Journey /> }])

    await screen.findByRole('heading', { name: 'Honeymoon' })
    expect(screen.queryByText('Japan')).not.toBeInTheDocument()
  })
})
