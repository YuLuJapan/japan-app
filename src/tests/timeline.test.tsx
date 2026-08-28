import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { JourneyStepsSlider, nameSize } from '../components/JourneyStepsSlider'
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

// A tile is 150px wide and the design sets every name at 17px — which is right
// for "Tokyo" and "Hakone", and too wide for "Fujikawaguchiko". That name is a
// single word, so wrapping cannot rescue it; the size has to come down, and it
// must come down only for the names that need it.
describe('nameSize', () => {
  it('leaves the design’s size alone for names that fit', () => {
    expect(nameSize('Tokyo')).toBe(17)
    expect(nameSize('Hakone')).toBe(17)
  })

  it('shrinks a long single word until it fits the tile', () => {
    const size = nameSize('Fujikawaguchiko')
    expect(size).toBeLessThan(17)
    // Still has to read over a photo, so it never collapses to nothing.
    expect(size).toBeGreaterThanOrEqual(11)
    expect('Fujikawaguchiko'.length * 0.58 * size).toBeLessThanOrEqual(130)
  })

  it('measures the longest word, not the whole string — the rest can wrap', () => {
    // Three short words are wider than the tile in total but each wraps, so
    // nothing has to shrink.
    expect(nameSize('New York City')).toBe(17)
  })

  it('never returns something unusable for an absurd name', () => {
    expect(nameSize('Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch')).toBe(11)
    expect(nameSize('')).toBe(17)
  })
})

describe('JourneyStepsSlider (US2)', () => {
  // Same pairing as the day strip: -mx-5/px-5 puts the first card in line with
  // "The journey" above it, and snapping scrolls that padding away unless
  // scroll-padding is set to match.
  it('carries scroll padding to match its own padding', () => {
    renderSlider(new Date('2026-01-01T12:00:00Z'))
    const slider = screen.getByTestId('journey-slider')
    expect(slider.className).toContain('px-5')
    expect(slider.className).toContain('scroll-px-5')
  })

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

  it('shows a long city name in full rather than clipping it', () => {
    render(
      <MemoryRouter>
        <JourneyStepsSlider
          steps={[{ ...steps[0], zone: { ...steps[0].zone!, name: 'Fujikawaguchiko' } }]}
          today={new Date('2026-01-01T12:00:00Z')}
          tripId="trip-1"
        />
      </MemoryRouter>
    )
    const name = screen.getByText('Fujikawaguchiko')
    expect(name.className).not.toContain('truncate')
    expect(name.style.fontSize).toBe('14px')
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
