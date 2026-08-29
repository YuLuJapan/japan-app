import { describe, expect, it } from 'vitest'
import type { ItineraryItem, TripStep } from '../api/types'
import {
  daySections,
  enumerateDays,
  isNextDay,
  isTravelDay,
  movingDay,
  primaryStep,
  zoneDays,
} from '../lib/schedule'

const counts = { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 }
const zone = (id: string, name: string) => ({
  id,
  name,
  name_ja: null,
  summary: null,
  place_counts: counts,
})

// Tokyo Oct 5–9, then Kyoto Oct 9–12 — Oct 9 is the shared travel/checkout day.
const steps: TripStep[] = [
  {
    id: 's1',
    position: 1,
    start_date: '2026-10-05',
    end_date: '2026-10-09',
    zone: zone('z-tokyo', 'Tokyo'),
  },
  {
    id: 's2',
    position: 2,
    start_date: '2026-10-09',
    end_date: '2026-10-12',
    zone: zone('z-kyoto', 'Kyoto'),
  },
]
const allDays = enumerateDays('2026-10-05', '2026-10-12')

const itemOn = (zoneId: string | null, title: string): ItineraryItem => ({
  id: title,
  trip_id: 'trip-1',
  zone_id: zoneId,
  place_id: null,
  day: '2026-10-09',
  start_time: null,
  title,
  note: null,
  position: 0,
  highlight: false,
  icon: null,
})

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

  it('zoneDays gives the moving day to both cities', () => {
    // Oct 9 is on both lists: the morning is still Tokyo, the night is Kyoto.
    expect(zoneDays(steps, 'z-tokyo', allDays)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ])
    expect(zoneDays(steps, 'z-kyoto', allDays)).toEqual([
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
    ])
  })

  it('movingDay names the other city, and its direction', () => {
    // Leaving Tokyo for Kyoto
    expect(movingDay(steps, 'z-tokyo', '2026-10-09')).toEqual({
      from: null,
      to: steps[1].zone,
    })
    // The same date seen from Kyoto: arriving from Tokyo
    expect(movingDay(steps, 'z-kyoto', '2026-10-09')).toEqual({
      from: steps[0].zone,
      to: null,
    })
    // A day spent wholly in one city isn't a moving day
    expect(movingDay(steps, 'z-tokyo', '2026-10-06')).toBeNull()
    // ...and neither is the trip's last day
    expect(movingDay(steps, 'z-kyoto', '2026-10-12')).toBeNull()
    // A city the day doesn't touch at all
    expect(movingDay(steps, 'z-kyoto', '2026-10-06')).toBeNull()
  })

  it('movingDay reports both ends of a day that only passes through a city', () => {
    const hakone = zone('z-hakone', 'Hakone')
    const passing: TripStep[] = [
      steps[0],
      { id: 's-h', position: 2, start_date: '2026-10-09', end_date: '2026-10-09', zone: hakone },
      { ...steps[1], position: 3 },
    ]
    expect(movingDay(passing, 'z-hakone', '2026-10-09')).toEqual({
      from: steps[0].zone,
      to: steps[1].zone,
    })
  })

  it('daySections bands a moving day by city, in the order the day is lived', () => {
    const morning = itemOn('z-tokyo', 'Last coffee')
    const afternoon = itemOn('z-kyoto', 'Fushimi Inari')
    const items = [morning, afternoon]

    // From Tokyo: our morning, then Kyoto's afternoon under Kyoto's name.
    expect(daySections(steps, 'z-tokyo', '2026-10-09', items)).toEqual([
      { zone: null, direction: null, items: [morning] },
      { zone: steps[1].zone, direction: 'after', items: [afternoon] },
    ])
    // From Kyoto the same day reads the other way round.
    expect(daySections(steps, 'z-kyoto', '2026-10-09', items)).toEqual([
      { zone: steps[0].zone, direction: 'before', items: [morning] },
      { zone: null, direction: null, items: [afternoon] },
    ])
  })

  it('daySections keeps the city being left readable when every item is pinned to the next', () => {
    // The reported bug: the trip screen stamped the arrival city on everything, so
    // Tokyo's own last morning had no band of its own at all.
    const items = [itemOn('z-kyoto', 'Onsen on arrival')]
    expect(daySections(steps, 'z-tokyo', '2026-10-09', items)).toEqual([
      { zone: null, direction: null, items: [] },
      { zone: steps[1].zone, direction: 'after', items },
    ])
  })

  it('daySections gives an unpinned activity to both cities, and an ordinary day one band', () => {
    const loose = itemOn(null, 'Somewhere on the way')
    for (const id of ['z-tokyo', 'z-kyoto']) {
      expect(daySections(steps, id, '2026-10-09', [loose])).toEqual([
        { zone: null, direction: null, items: [loose] },
      ])
    }
    // A day spent wholly in Tokyo has nothing to band.
    const solo = { ...itemOn('z-tokyo', 'Tsukiji'), day: '2026-10-06' }
    expect(daySections(steps, 'z-tokyo', '2026-10-06', [solo])).toEqual([
      { zone: null, direction: null, items: [solo] },
    ])
  })

  it('isNextDay detects consecutive dates, including a return trip gap', () => {
    expect(isNextDay('2026-10-05', '2026-10-06')).toBe(true)
    expect(isNextDay('2026-10-05', '2026-10-07')).toBe(false)
    // a zone revisited later in the trip (e.g. Tokyo bookending the itinerary)
    expect(isNextDay('2026-09-24', '2026-10-11')).toBe(false)
  })
})
