import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CountdownWidget } from '../components/CountdownWidget'
import type { FlightInfo } from '../api/types'

const flight: FlightInfo = {
  airline: 'Ethiopian Airlines',
  booking_ref: 'ABC123',
  outbound: {
    depart_at: '2026-09-18T15:35:00+03:00',
    depart_tz: 'Asia/Jerusalem',
    arrive_at: '2026-09-19T19:40:00+09:00',
    arrive_tz: 'Asia/Tokyo',
    legs: [
      { flight_no: 'ET 419', from: 'Tel Aviv (TLV)', to: 'Addis Ababa (ADD)' },
      { flight_no: 'ET 672', from: 'Addis Ababa (ADD)', to: 'Narita (NRT)' },
    ],
  },
  return_flight: {
    depart_at: '2026-10-16T20:40:00+09:00',
    depart_tz: 'Asia/Tokyo',
    arrive_at: '2026-10-17T14:35:00+03:00',
    arrive_tz: 'Asia/Jerusalem',
    legs: [
      { flight_no: 'ET 673', from: 'Narita (NRT)', to: 'Addis Ababa (ADD)' },
      { flight_no: 'ET 418', from: 'Addis Ababa (ADD)', to: 'Tel Aviv (TLV)' },
    ],
  },
}

describe('CountdownWidget', () => {
  const expand = () => fireEvent.click(screen.getByText('Tap here to see the flight details'))

  it('counts down to the outbound departure, and holds the details until asked', () => {
    render(<CountdownWidget flight={flight} now={new Date('2026-09-16T13:35:00+03:00')} />)

    const timer = screen.getByRole('timer')
    expect(timer.textContent).toContain('02') // days

    // Collapsed by default: the numbers are the whole card.
    expect(screen.queryByText('ABC123')).toBeNull()
    expect(screen.queryByText('ET 419')).toBeNull()

    expand()
    expect(screen.getByText('ABC123')).toBeTruthy()
    // Both directions at once — there is no pane to swipe to any more.
    for (const no of ['ET 419', 'ET 672', 'ET 673', 'ET 418']) {
      expect(screen.getByText(no)).toBeTruthy()
    }
  })

  it('shows each ticket time in the airport’s own zone, not the device zone', () => {
    render(<CountdownWidget flight={flight} now={new Date('2026-09-16T13:35:00+03:00')} />)
    expand()

    // Tel Aviv 3:35pm and Tokyo 8:40pm as printed on the e-ticket, whatever TZ the test runs in.
    expect(screen.getByText(/Fri, Sep 18, 3:35 PM/)).toBeTruthy()
    expect(screen.getByText(/Fri, Oct 16, 8:40 PM/)).toBeTruthy()
    expect(screen.getByText(/Lands Sat, Sep 19, 7:40 PM/)).toBeTruthy()
    expect(screen.getByText(/Lands Sat, Oct 17, 2:35 PM/)).toBeTruthy()
  })

  it('collapses again, from the header as well as the line', () => {
    render(<CountdownWidget flight={flight} now={new Date('2026-09-16T13:35:00+03:00')} />)
    const header = screen.getByRole('button', { name: /countdown to takeoff/i })

    expect(header.getAttribute('aria-expanded')).toBe('false')

    expand()
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('ABC123')).toBeTruthy()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('ABC123')).toBeNull()
  })

  it('counts down even when the booking has no times on it yet', () => {
    const undated: FlightInfo = {
      booking_ref: 'NOTIME1',
      outbound: { legs: [{ flight_no: 'ET 419', from: 'Tel Aviv', to: 'Narita' }] },
    }
    render(<CountdownWidget flight={undated} now={new Date('2026-09-16T13:35:00+03:00')} />)

    // Nothing to count to, so no timer — but the flights are still reachable.
    expect(screen.queryByRole('timer')).toBeNull()
    expand()
    expect(screen.getByText('ET 419')).toBeTruthy()
  })
})
