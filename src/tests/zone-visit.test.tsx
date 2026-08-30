// What a city page says about which stay you are looking at.
//
// The rule that matters is the negative one: a city visited once must gain
// nothing at all. Every trip but the ones this feature exists for is that
// case, so it is the regression most likely to go unnoticed.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VisitSwitcher } from '../components/VisitSwitcher'
import type { VisitInfo } from '../api/types'

const at = (visit: VisitInfo) =>
  render(
    <MemoryRouter>
      <VisitSwitcher tripId="trip-1" cityName="Tokyo" visit={visit} />
    </MemoryRouter>
  )

const onlyVisit: VisitInfo = {
  step_id: 'step-1',
  start_date: '2026-10-05',
  end_date: '2026-10-09',
  ordinal: 1,
  total: 1,
  siblings: [],
}

const firstOfTwo: VisitInfo = {
  ...onlyVisit,
  total: 2,
  siblings: [
    { zone_id: 'zone-tokyo-2', start_date: '2026-10-12', end_date: '2026-10-14', ordinal: 2 },
  ],
}

describe('a city visited once (FR-003)', () => {
  it('renders nothing whatsoever', () => {
    const { container } = at(onlyVisit)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('renders nothing when the visit block is %s', (_label, visit) => {
    const { container } = render(
      <MemoryRouter>
        <VisitSwitcher tripId="trip-1" cityName="Tokyo" visit={visit} />
      </MemoryRouter>
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('a city visited twice', () => {
  it('says which stay this is, and how many there are', () => {
    at(firstOfTwo)
    expect(screen.getByText('1st of 2 stays in Tokyo')).toBeInTheDocument()
  })

  it('offers a way to the other stay, labelled by its dates', () => {
    at(firstOfTwo)
    const link = screen.getByRole('link', { name: 'Oct 12–14' })
    expect(link).toHaveAttribute('href', '/trips/trip-1/zones/zone-tokyo-2')
  })

  it('does not offer a link back to the stay you are already on', () => {
    at(firstOfTwo)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('labels a stay that has left the journey by its number, not its dates', () => {
    // A stop can be deleted while its content is kept (FR-011), which leaves a
    // sibling with no dates at all. It still has to be reachable.
    at({
      ...firstOfTwo,
      siblings: [{ zone_id: 'zone-tokyo-2', start_date: null, end_date: null, ordinal: 2 }],
    })
    expect(screen.getByRole('link', { name: '2nd stay' })).toBeInTheDocument()
  })

  it('explains why the two pages hold different things', () => {
    // Without this a traveller looking at half their Tokyo places has no
    // reason to think the other half is anywhere.
    at(firstOfTwo)
    expect(screen.getByText(/each stay keeps its own places and notes/i)).toBeInTheDocument()
  })
})
