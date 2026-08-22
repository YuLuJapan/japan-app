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
  it('lists under its composed title', async () => {
    mocks.get.mockResolvedValue({ trips: [unnamedTrip] })
    renderAt('/trips', [{ path: '/trips', element: <TripsList /> }])

    expect(await screen.findByText('Yuval and Luciana in Japan')).toBeInTheDocument()
  })

  it('accents the country inside the hero title', async () => {
    mocks.get.mockResolvedValue({ trip: unnamedTrip, steps: [], flight: null })
    renderAt('/trips/trip-1', [{ path: '/trips/:tripId', element: <Journey /> }])

    await screen.findByRole('heading', { name: 'Yuval and Luciana in Japan' })
    // The travellers hold the first line, the destination gets its own.
    expect(screen.getByText('Yuval and Luciana')).toHaveClass('block')
    expect(screen.getByText('Japan')).toHaveClass('text-brand')
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
