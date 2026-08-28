import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { JourneyStepsSlider } from '../components/JourneyStepsSlider'
import type { TripStep } from '../api/types'

const counts = { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 }
const steps: TripStep[] = [
  {
    id: 's1',
    position: 1,
    start_date: '2026-10-05',
    end_date: '2026-10-09',
    zone: { id: 'z1', name: 'Tokyo', name_ja: '東京', summary: null, place_counts: counts },
  },
  {
    id: 's2',
    position: 2,
    start_date: '2026-10-09',
    end_date: '2026-10-12',
    zone: { id: 'z2', name: 'Kyoto', name_ja: '京都', summary: null, place_counts: counts },
  },
]

const renderSlider = (today: Date) =>
  render(
    <MemoryRouter>
      <JourneyStepsSlider steps={steps} today={today} tripId="trip-1" />
    </MemoryRouter>
  )

describe('JourneyStepsSlider (US2)', () => {
  it('renders all steps in order, numbered, and links each to its city', () => {
    renderSlider(new Date('2026-01-01T12:00:00Z'))
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveTextContent('Tokyo')
    expect(links[1]).toHaveTextContent('Kyoto')
    // Numbered rather than dated: the redesign's tiles carry the position in
    // the trip, and the dates moved to the city's own screen and the day rail.
    expect(links[0]).toHaveTextContent('1')
    expect(links[1]).toHaveTextContent('2')
    expect(links[0]).not.toHaveTextContent('Oct 5')
    expect(links[0]).toHaveAttribute('href', '/trips/trip-1/zones/z1')
  })

  it('highlights the current step when today is inside its dates (FR-006)', () => {
    renderSlider(new Date('2026-10-10T12:00:00Z'))
    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAttribute('data-status', 'past')
    expect(links[1]).toHaveAttribute('data-status', 'current')
    expect(screen.getByText(/Now/)).toBeInTheDocument()
  })

  it('marks no step current when the trip is entirely in the future (edge case)', () => {
    renderSlider(new Date('2026-01-01T12:00:00Z'))
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('data-status', 'future')
    }
    expect(screen.queryByText(/Now/)).not.toBeInTheDocument()
  })

  it('marks no step current when the trip is entirely in the past (edge case)', () => {
    renderSlider(new Date('2027-01-01T12:00:00Z'))
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('data-status', 'past')
    }
  })
})
