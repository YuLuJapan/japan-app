import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import PlaceDetail from '../pages/PlaceDetail'
import Zone from '../pages/Zone'
import { renderAt } from './helpers'

// No stubbed client here: these pages fetch from the real API, which reads the
// fixture out of a real database. What they render is what the server sends.

describe('Zone page (US1)', () => {
  it('shows only categories that have places, without breaking navigation (FR-012)', async () => {
    // zone-tokyo holds one food place and one stay, and nothing else.
    renderAt('/trips/trip-1/zones/zone-tokyo', [
      { path: '/trips/:tripId/zones/:zoneId', element: <Zone /> },
    ])

    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    expect(screen.getByTestId('category-food')).toBeInTheDocument()
    expect(screen.getByTestId('category-hotel')).toBeInTheDocument()
    expect(screen.queryByTestId('category-attraction')).not.toBeInTheDocument()
    expect(screen.queryByTestId('category-shopping')).not.toBeInTheDocument()
    // zone-level tips visible (FR-004)
    expect(screen.getByText('Get a Suica card')).toBeInTheDocument()
  })
})

describe('PlaceDetail page (US1)', () => {
  it('shows tips alongside the place details (US1 AC3)', async () => {
    renderAt('/trips/trip-1/places/place-ramen', [
      { path: '/trips/:tripId/places/:placeId', element: <PlaceDetail /> },
    ])

    expect(await screen.findByText('Ramen Bar')).toBeInTheDocument()
    expect(screen.getByText(/A very long description/)).toBeInTheDocument()
    expect(screen.getByText('Cash only')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Site/ })).toHaveAttribute(
      'href',
      'https://example.com'
    )
  })
})
