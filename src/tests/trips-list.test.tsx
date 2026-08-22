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

// The deployed database lets trips.name be null, and a row arrived that way —
// the list used to read name[0] for the card's initial and took the whole app
// down with it.
const namelessTrip = {
  id: 'trip-1',
  name: null,
  start_date: '2026-09-18',
  end_date: '2026-10-16',
  description: null,
  people: [{ name: 'Yuval' }, { name: 'Luciana' }],
}

describe('a trip with no name', () => {
  it('still lists, without crashing on the card initial', async () => {
    mocks.get.mockResolvedValue({ trips: [namelessTrip] })
    renderAt('/trips', [{ path: '/trips', element: <TripsList /> }])

    expect(await screen.findByText('Untitled trip')).toBeInTheDocument()
  })

  it('keeps the travellers in the hero and drops the "in …" half', async () => {
    mocks.get.mockResolvedValue({ trip: namelessTrip, steps: [], flight: null })
    renderAt('/trips/trip-1', [{ path: '/trips/:tripId', element: <Journey /> }])

    expect(await screen.findByRole('heading', { name: 'Yuval & Luciana' })).toBeInTheDocument()
    expect(screen.queryByText(/in null/)).not.toBeInTheDocument()
  })
})
