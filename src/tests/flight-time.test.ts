// The conversion the flight form depends on. A ticket says "15:35 from TLV";
// what gets stored is an absolute instant plus the zone that time was written
// in, and getting the offset wrong silently moves a flight by an hour.
import { describe, expect, it } from 'vitest'
import {
  COMMON_ZONES,
  commonTimeZones,
  deviceTimeZone,
  instantToZoned,
  timeZoneOptions,
  zonedToInstant,
} from '../lib/flight-time'

describe('zonedToInstant', () => {
  it('reads a local time as the zone it was written in', () => {
    // 15:35 in Jerusalem on 18 Sep is UTC+3 (IDT) → 12:35Z.
    expect(zonedToInstant('2026-09-18', '15:35', 'Asia/Jerusalem')).toBe('2026-09-18T12:35:00.000Z')
  })

  it('handles a zone on the other side of the date line', () => {
    // 19:40 in Tokyo is UTC+9 year-round → 10:40Z the same day.
    expect(zonedToInstant('2026-09-19', '19:40', 'Asia/Tokyo')).toBe('2026-09-19T10:40:00.000Z')
  })

  it('uses the offset in force on that date, not today’s', () => {
    // Jerusalem is UTC+2 in January and UTC+3 in July. One zone, two answers —
    // this is the case a naive fixed-offset conversion gets wrong.
    expect(zonedToInstant('2026-01-15', '12:00', 'Asia/Jerusalem')).toBe('2026-01-15T10:00:00.000Z')
    expect(zonedToInstant('2026-07-15', '12:00', 'Asia/Jerusalem')).toBe('2026-07-15T09:00:00.000Z')
  })

  it('round-trips back to the same wall clock', () => {
    for (const [date, time, tz] of [
      ['2026-09-18', '15:35', 'Asia/Jerusalem'],
      ['2026-10-16', '20:40', 'Asia/Tokyo'],
      ['2026-03-29', '23:30', 'Europe/London'],
      ['2026-01-01', '00:00', 'America/New_York'],
    ] as const) {
      const instant = zonedToInstant(date, time, tz)
      expect(instantToZoned(instant!, tz)).toEqual({ date, time })
    }
  })

  it('returns null for input the form has not finished', () => {
    expect(zonedToInstant('', '15:35', 'Asia/Tokyo')).toBeNull()
    expect(zonedToInstant('2026-09-18', '', 'Asia/Tokyo')).toBeNull()
    expect(zonedToInstant('2026-09-18', '15:35', '')).toBeNull()
    expect(zonedToInstant('not-a-date', '15:35', 'Asia/Tokyo')).toBeNull()
  })

  it('returns null rather than throwing on an unknown zone', () => {
    expect(zonedToInstant('2026-09-18', '15:35', 'Mars/Olympus_Mons')).toBeNull()
  })
})

describe('instantToZoned', () => {
  it('shows the ticket time in the airport’s zone, not the device’s', () => {
    const instant = '2026-09-18T12:35:00.000Z'
    expect(instantToZoned(instant, 'Asia/Jerusalem')).toEqual({ date: '2026-09-18', time: '15:35' })
    expect(instantToZoned(instant, 'Asia/Tokyo')).toEqual({ date: '2026-09-18', time: '21:35' })
  })

  it('is empty for a flight with no times yet', () => {
    expect(instantToZoned(undefined, 'Asia/Tokyo')).toEqual({ date: '', time: '' })
    expect(instantToZoned('2026-09-18T12:35:00Z', undefined)).toEqual({ date: '', time: '' })
    expect(instantToZoned('nonsense', 'Asia/Tokyo')).toEqual({ date: '', time: '' })
  })
})

describe('the zone picker', () => {
  it('offers real zones, including this device’s', () => {
    const options = timeZoneOptions()
    expect(options).toContain(deviceTimeZone())
    expect(options).toContain('Asia/Tokyo')
    expect(new Set(options).size).toBe(options.length)
  })

  it('shortlists the zones this trip routes through, and this device’s', () => {
    const common = commonTimeZones().map((o) => o.zone)
    expect(common).toEqual(expect.arrayContaining(['Asia/Tokyo', 'Asia/Bangkok', 'Asia/Dubai']))
    expect(common).toContain(deviceTimeZone())
  })

  it('offers nothing the API would refuse', () => {
    // A shortlist entry that Intl does not know would 400 on save, which is
    // worse than the zone simply not being offered.
    for (const { zone } of commonTimeZones()) {
      expect(zonedToInstant('2026-09-18', '12:00', zone)).not.toBeNull()
    }
  })

  it('finds Abu Dhabi under Asia/Dubai, because Asia/Abu_Dhabi is not a zone', () => {
    // The UAE keeps one zone for the whole country. The invented spelling is
    // rejected by Intl, so labelling is the only way someone connecting
    // through AUH lands on the right entry.
    expect(zonedToInstant('2026-09-18', '12:00', 'Asia/Abu_Dhabi')).toBeNull()
    const uae = COMMON_ZONES.find((o) => o.zone === 'Asia/Dubai')
    expect(uae?.label).toMatch(/abu dhabi/i)
  })

  it('reads Bangkok and Dubai at their real offsets', () => {
    // Thailand UTC+7, UAE UTC+4, neither with DST.
    expect(zonedToInstant('2026-09-18', '19:00', 'Asia/Bangkok')).toBe('2026-09-18T12:00:00.000Z')
    expect(zonedToInstant('2026-09-18', '16:00', 'Asia/Dubai')).toBe('2026-09-18T12:00:00.000Z')
  })
})
