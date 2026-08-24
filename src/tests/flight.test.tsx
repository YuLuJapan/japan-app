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
  it('counts down to the outbound departure and lists both directions', () => {
    render(<CountdownWidget flight={flight} now={new Date('2026-09-16T13:35:00+03:00')} />)

    const timer = screen.getByRole('timer')
    expect(timer.textContent).toContain('02') // days
    expect(screen.getByText('ABC123')).toBeTruthy()

    for (const no of ['ET 419', 'ET 672', 'ET 673', 'ET 418']) {
      expect(screen.getByText(no)).toBeTruthy()
    }
  })

  it('shows each ticket time in the airport’s own zone, not the device zone', () => {
    render(<CountdownWidget flight={flight} now={new Date('2026-09-16T13:35:00+03:00')} />)

    // Tel Aviv 3:35pm and Tokyo 8:40pm as printed on the e-ticket, whatever TZ the test runs in.
    expect(screen.getByText(/Fri, Sep 18, 3:35 PM/)).toBeTruthy()
    expect(screen.getByText(/Fri, Oct 16, 8:40 PM/)).toBeTruthy()
    expect(screen.getByText(/Lands Sat, Sep 19, 7:40 PM/)).toBeTruthy()
    expect(screen.getByText(/Lands Sat, Oct 17, 2:35 PM/)).toBeTruthy()
  })

  it('starts on the outbound pane and slides to the return one on demand', () => {
    const { container } = render(
      <CountdownWidget flight={flight} now={new Date('2026-09-16T13:35:00+03:00')} />
    )
    const track = () => container.querySelector('[style*="translateX"]') as HTMLElement

    expect(track().style.transform).toBe('translateX(-0%)')

    fireEvent.click(screen.getByLabelText('Show return flight'))
    expect(track().style.transform).toBe('translateX(-100%)')

    fireEvent.click(screen.getByLabelText('Show outbound flight'))
    expect(track().style.transform).toBe('translateX(-0%)')

    // the dots jump straight to a pane too
    fireEvent.click(screen.getByLabelText('Return flight'))
    expect(track().style.transform).toBe('translateX(-100%)')
  })

  it('swipes between the two directions', () => {
    const { container } = render(
      <CountdownWidget flight={flight} now={new Date('2026-09-16T13:35:00+03:00')} />
    )
    const track = () => container.querySelector('[style*="translateX"]') as HTMLElement
    const viewport = track().parentElement as HTMLElement

    const swipe = (from: number, to: number) => {
      fireEvent.touchStart(viewport, { touches: [{ clientX: from }] })
      fireEvent.touchEnd(viewport, { changedTouches: [{ clientX: to }] })
    }

    swipe(200, 60) // drag left → return
    expect(track().style.transform).toBe('translateX(-100%)')

    swipe(60, 200) // drag right → outbound
    expect(track().style.transform).toBe('translateX(-0%)')

    swipe(200, 180) // too short to count
    expect(track().style.transform).toBe('translateX(-0%)')
  })
})
