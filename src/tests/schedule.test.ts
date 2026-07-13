import { describe, expect, it } from 'vitest'
import type { TripStep } from '../api/types'
import { enumerateDays, isNextDay, isTravelDay, primaryStep, zoneDays } from '../lib/schedule'

const counts = { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 }
const zone = (id: string, name: string) => ({ id, name, name_ja: null, summary: null, place_counts: counts })

// Tokyo Oct 5–9, then Kyoto Oct 9–12 — Oct 9 is the shared travel/checkout day.
const steps: TripStep[] = [
  { id: 's1', position: 1, start_date: '2026-10-05', end_date: '2026-10-09', zone: zone('z-tokyo', 'Tokyo') },
  { id: 's2', position: 2, start_date: '2026-10-09', end_date: '2026-10-12', zone: zone('z-kyoto', 'Kyoto') },
]
const allDays = enumerateDays('2026-10-05', '2026-10-12')

describe('schedule helpers', () => {
  it('enumerateDays is inclusive on both ends', () => {
    expect(allDays).toHaveLength(8)
    expect(allDays[0]).toBe('2026-10-05')
    expect(allDays.at(-1)).toBe('2026-10-12')
  })

  it('primaryStep picks the city you sleep in that night', () => {
    expect(primaryStep(steps, '2026-10-06')?.zone?.id).toBe('z-tokyo')
    // travel day: primary is the arrival city (you sleep there)
    expect(primaryStep(steps, '2026-10-09')?.zone?.id).toBe('z-kyoto')
    // final day equals an end date with no next stay → the last city
    expect(primaryStep(steps, '2026-10-12')?.zone?.id).toBe('z-kyoto')
  })

  it('isTravelDay is true only when two cities share the date', () => {
    expect(isTravelDay(steps, '2026-10-09')).toBe(true)
    expect(isTravelDay(steps, '2026-10-06')).toBe(false)
  })

  it('zoneDays splits days by primary city (no overlap on the travel day)', () => {
    expect(zoneDays(steps, 'z-tokyo', allDays)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
    ])
    expect(zoneDays(steps, 'z-kyoto', allDays)).toEqual([
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
    ])
  })

  it('isNextDay detects consecutive dates, including a return trip gap', () => {
    expect(isNextDay('2026-10-05', '2026-10-06')).toBe(true)
    expect(isNextDay('2026-10-05', '2026-10-07')).toBe(false)
    // a zone revisited later in the trip (e.g. Tokyo bookending the itinerary)
    expect(isNextDay('2026-09-24', '2026-10-11')).toBe(false)
  })
})
