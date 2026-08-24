import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import Journey from '../pages/Journey'
import TripsList from '../pages/TripsList'
import { patchTrip } from './data'
import { renderAt } from './helpers'

// The composed title is the server's, not a string a test decided on: these
// cases change the trip in the database and let the API compose it.

/** The common shape since 0015: no name override, so the title is composed. */
beforeEach(async () => {
  await patchTrip('trip-1', {
    name: null,
    country: 'Japan',
    people: [{ name: 'Yuval' }, { name: 'Luciana' }],
    start_date: '2026-09-18',
    end_date: '2026-10-16',
  })
})

describe('a trip with no name override', () => {
  it('lists under its destination, not the composed sentence', async () => {
    renderAt('/trips', [{ path: '/trips', element: <TripsList /> }])

    expect(await screen.findByText('Japan')).toBeInTheDocument()
    expect(screen.queryByText('Yuval and Luciana in Japan')).not.toBeInTheDocument()
  })

  it('lists under the name override when there is one', async () => {
    await patchTrip('trip-1', { name: 'Honeymoon' })
    renderAt('/trips', [{ path: '/trips', element: <TripsList /> }])

    expect(await screen.findByText('Honeymoon')).toBeInTheDocument()
    expect(screen.queryByText('Japan')).not.toBeInTheDocument()
  })

  it('accents the country inside the hero title', async () => {
    renderAt('/trips/trip-1', [{ path: '/trips/:tripId', element: <Journey /> }])

    await screen.findByRole('heading', { name: 'Yuval and Luciana in Japan' })
    // The travellers hold the first line, the destination gets its own.
    expect(screen.getByText('Yuval and Luciana')).toHaveClass('block')
    expect(screen.getByText('Japan')).toHaveClass('text-brand')
  })

  it('leaves a name override plain — there is no country at its tail to accent', async () => {
    await patchTrip('trip-1', { name: 'Honeymoon' })
    renderAt('/trips/trip-1', [{ path: '/trips/:tripId', element: <Journey /> }])

    await screen.findByRole('heading', { name: 'Honeymoon' })
    expect(screen.queryByText('Japan')).not.toBeInTheDocument()
  })
})
