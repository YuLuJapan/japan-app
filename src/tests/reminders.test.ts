import { describe, expect, it } from 'vitest'
import {
  TOKYO_TZ,
  formatInTimeZone,
  instantToWallClock,
  relativeTime,
  timeZoneLabel,
  wallClockToInstant,
} from '../lib/reminders'

describe('wallClockToInstant', () => {
  it('reads a wall clock in Japan time (UTC+9, no DST)', () => {
    expect(wallClockToInstant('2026-09-12', '09:00', TOKYO_TZ).toISOString()).toBe(
      '2026-09-12T00:00:00.000Z'
    )
  })

  it('reads a wall clock in Israel time, both sides of the DST switch', () => {
    // IDT (UTC+3) in September
    expect(wallClockToInstant('2026-09-12', '09:00', 'Asia/Jerusalem').toISOString()).toBe(
      '2026-09-12T06:00:00.000Z'
    )
    // IST (UTC+2) in December
    expect(wallClockToInstant('2026-12-12', '09:00', 'Asia/Jerusalem').toISOString()).toBe(
      '2026-12-12T07:00:00.000Z'
    )
  })

  it('handles midnight (the hour Intl renders as 24)', () => {
    expect(wallClockToInstant('2026-09-12', '00:00', TOKYO_TZ).toISOString()).toBe(
      '2026-09-11T15:00:00.000Z'
    )
  })

  it('round-trips through instantToWallClock', () => {
    for (const tz of [TOKYO_TZ, 'Asia/Jerusalem', 'UTC']) {
      const instant = wallClockToInstant('2026-10-16', '20:40', tz)
      expect(instantToWallClock(instant.toISOString(), tz)).toEqual({
        date: '2026-10-16',
        time: '20:40',
      })
    }
  })

  it('same instant, two zones — the whole point of the time zone chip', () => {
    const instant = wallClockToInstant('2026-09-12', '09:00', TOKYO_TZ)
    expect(instantToWallClock(instant.toISOString(), 'Asia/Jerusalem')).toEqual({
      date: '2026-09-12',
      time: '03:00',
    })
  })
})

describe('display helpers', () => {
  it('formats an instant in the zone it was set in', () => {
    const text = formatInTimeZone('2026-09-12T00:00:00.000Z', TOKYO_TZ)
    expect(text).toMatch(/12 Sep/)
    expect(text).toMatch(/09:00/)
  })

  it('shortens zone names for the chips', () => {
    expect(timeZoneLabel(TOKYO_TZ)).toBe('Tokyo')
    expect(timeZoneLabel('America/New_York')).toBe('New York')
  })

  it('describes how far away a reminder is', () => {
    const now = new Date('2026-09-12T00:00:00Z')
    expect(relativeTime('2026-09-15T00:00:00Z', now)).toMatch(/3 days/)
    expect(relativeTime('2026-09-12T02:00:00Z', now)).toMatch(/2 hours/)
    expect(relativeTime('2026-09-11T23:30:00Z', now)).toMatch(/30 minutes ago/)
    expect(relativeTime('2026-09-12T00:00:20Z', now)).toBe('now')
  })
})
