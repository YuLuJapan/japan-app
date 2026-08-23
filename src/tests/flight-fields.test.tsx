// Roughly twenty inputs across two directions, on a phone, for something most
// trips do not have yet — so the section stays shut until it is asked for.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FlightFields } from '../components/FlightFields'
import { emptyFlight, toDraft } from '../lib/flight-draft'

describe('the flight section', () => {
  it('starts collapsed on a trip with no booking', () => {
    render(<FlightFields draft={emptyFlight()} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /add flight details/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByLabelText('Airline')).not.toBeInTheDocument()
  })

  it('opens on demand', async () => {
    const user = userEvent.setup()
    render(<FlightFields draft={emptyFlight()} onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: /add flight details/i }))
    expect(screen.getByLabelText('Airline')).toBeInTheDocument()
    expect(screen.getByLabelText('Outbound flight number 1')).toBeInTheDocument()
  })

  it('starts open when there is already a booking to edit', () => {
    // Arriving at a collapsed section that silently contains your flights is
    // worse than the extra tap.
    const draft = toDraft({ outbound: { legs: [{ flight_no: 'ET 419', from: 'TLV', to: 'NRT' }] } })
    render(<FlightFields draft={draft} onChange={() => {}} />)
    expect(screen.getByLabelText('Airline')).toBeInTheDocument()
  })

  it('summarises the booking while collapsed', async () => {
    const user = userEvent.setup()
    const draft = toDraft({ outbound: { legs: [{ flight_no: 'ET 419', from: 'TLV', to: 'NRT' }] } })
    render(<FlightFields draft={draft} onChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: /hide/i }))
    expect(screen.getByText('TLV → NRT')).toBeInTheDocument()
  })
})
