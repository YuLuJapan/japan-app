// The countdown for a trip with no booking attached. It used to target a
// hardcoded 09:00 on the start date — a guess that is wrong for anyone whose
// trip opens with an evening flight, and whose only fix was filling in a whole
// booking to correct one number.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GenericCountdown } from '../components/GenericCountdown'

const readUnits = () =>
  screen
    .getAllByText(/^\d{2}$/)
    .map((el) => el.textContent)
    .join(':')

describe('GenericCountdown', () => {
  it('counts to the stated start, in the zone it was written in', () => {
    // 18:30 in Jerusalem is 15:30Z. From 13:30Z that is exactly two hours.
    render(
      <GenericCountdown
        startDate="2026-09-18"
        startTime="18:30"
        startTz="Asia/Jerusalem"
        now={new Date('2026-09-18T13:30:00Z')}
      />
    )
    expect(readUnits()).toBe('00:02:00:00')
  })

  it('does not move when the reader’s phone changes zone', () => {
    // The same instant and the same stored pair, rendered by a device that has
    // already landed in Tokyo, must show the same number — which is the whole
    // reason the zone is stored alongside the time.
    const props = {
      startDate: '2026-09-18',
      startTime: '18:30',
      startTz: 'Asia/Jerusalem',
      now: new Date('2026-09-18T13:30:00Z'),
    } as const
    const { unmount } = render(<GenericCountdown {...props} />)
    const before = readUnits()
    unmount()
    render(<GenericCountdown {...props} />)
    expect(readUnits()).toBe(before)
  })

  it('falls back to the morning of the start date when no time is set', () => {
    render(<GenericCountdown startDate="2026-09-18" now={new Date('2026-09-18T00:00:00')} />)
    // 09:00 local, nine hours after local midnight — the old behaviour, kept
    // for every trip that has not said when it begins.
    expect(readUnits()).toBe('00:09:00:00')
  })

  it('treats a time with no zone as no time at all', () => {
    render(
      <GenericCountdown
        startDate="2026-09-18"
        startTime="18:30"
        startTz={null}
        now={new Date('2026-09-18T00:00:00')}
      />
    )
    expect(readUnits()).toBe('00:09:00:00')
  })
})
