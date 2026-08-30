// Which visit a zone is, and which visit a day belongs to — as a table.
// Pure: no server, no store, no HTTP.
import { describe, expect, it } from 'vitest'
import { visitForDay, visitOf } from '../src/lib/visit.js'
import type { JourneyStep, Zone } from '../src/lib/datastore.js'
import { primaryStep } from '../../src/lib/schedule'
import type { TripStep } from '../../src/api/types'

const zone = (id: string, name: string, cityKey: string | null = name.toLowerCase()): Zone => ({
  id,
  trip_id: 'trip-1',
  name,
  name_ja: null,
  summary: null,
  city_key: cityKey,
})

const step = (
  id: string,
  zoneId: string,
  start: string,
  end: string,
  position = 1
): JourneyStep => ({
  id,
  trip_id: 'trip-1',
  zone_id: zoneId,
  position,
  start_date: start,
  end_date: end,
})

describe('visitOf', () => {
  it('says nothing about a city visited once — total 1, no siblings', () => {
    // This is FR-003 in one assertion. Every surface renders its label, and an
    // empty label is what leaves a single-visit city untouched.
    const kyoto = zone('z-kyoto', 'Kyoto')
    const zones = [kyoto, zone('z-tokyo', 'Tokyo')]
    const steps = [
      step('s1', 'z-tokyo', '2026-10-05', '2026-10-09'),
      step('s2', 'z-kyoto', '2026-10-09', '2026-10-12', 2),
    ]
    expect(visitOf(kyoto, zones, steps)).toMatchObject({ ordinal: 1, total: 1, siblings: [] })
  })

  it('numbers the visits of a repeated city by date', () => {
    const first = zone('z-tokyo', 'Tokyo')
    const second = zone('z-tokyo-2', 'Tokyo')
    const zones = [first, second]
    const steps = [
      step('s3', 'z-tokyo-2', '2026-10-12', '2026-10-14', 3),
      step('s1', 'z-tokyo', '2026-10-05', '2026-10-09', 1),
    ]
    expect(visitOf(first, zones, steps)).toMatchObject({
      step_id: 's1',
      start_date: '2026-10-05',
      end_date: '2026-10-09',
      ordinal: 1,
      total: 2,
    })
    expect(visitOf(second, zones, steps)).toMatchObject({ ordinal: 2, total: 2 })
  })

  it('offers the other visits as siblings, never itself', () => {
    // The move picker reads this: offering a place its own visit would be a
    // no-op dressed as a choice.
    const first = zone('z-tokyo', 'Tokyo')
    const second = zone('z-tokyo-2', 'Tokyo')
    const third = zone('z-tokyo-3', 'Tokyo')
    const zones = [first, second, third]
    const steps = [
      step('s1', 'z-tokyo', '2026-10-05', '2026-10-09', 1),
      step('s2', 'z-tokyo-2', '2026-10-12', '2026-10-14', 2),
      step('s3', 'z-tokyo-3', '2026-10-20', '2026-10-22', 3),
    ]
    const v = visitOf(second, zones, steps)
    expect(v.total).toBe(3)
    expect(v.ordinal).toBe(2)
    expect(v.siblings.map((s) => s.zone_id)).toEqual(['z-tokyo', 'z-tokyo-3'])
    expect(v.siblings.map((s) => s.ordinal)).toEqual([1, 3])
  })

  it('never groups two different cities, however they are named', () => {
    const tokyo = zone('z-tokyo', 'Tokyo')
    const zones = [tokyo, zone('z-kyoto', 'Kyoto'), zone('z-osaka', 'Osaka')]
    const steps = [step('s1', 'z-tokyo', '2026-10-05', '2026-10-09')]
    expect(visitOf(tokyo, zones, steps).total).toBe(1)
  })

  it('treats a null city_key as "no siblings" rather than as a shared group', () => {
    // Grouping the keyless zones together would offer to move a place between
    // two cities that have nothing to do with each other.
    const a = zone('z-a', 'Somewhere', null)
    const b = zone('z-b', 'Elsewhere', null)
    const steps = [step('s1', 'z-a', '2026-10-05', '2026-10-09')]
    expect(visitOf(a, [a, b], steps).total).toBe(1)
    expect(visitOf(a, [a, b], steps).siblings).toEqual([])
  })

  it('falls back to journey position when two visits share a start date', () => {
    // A data error or a half-finished edit. Both must still be distinguishable,
    // which is why the label has an ordinal fallback at all.
    const first = zone('z-tokyo', 'Tokyo')
    const second = zone('z-tokyo-2', 'Tokyo')
    const steps = [
      step('s2', 'z-tokyo-2', '2026-10-05', '2026-10-09', 2),
      step('s1', 'z-tokyo', '2026-10-05', '2026-10-09', 1),
    ]
    expect(visitOf(first, [first, second], steps).ordinal).toBe(1)
    expect(visitOf(second, [first, second], steps).ordinal).toBe(2)
  })

  it('still describes a visit taken off the journey, and sorts it last', () => {
    // FR-011: deleting a stop keeps its content. The page has to open, with no
    // dates rather than a crash.
    const first = zone('z-tokyo', 'Tokyo')
    const orphan = zone('z-tokyo-2', 'Tokyo')
    const steps = [step('s1', 'z-tokyo', '2026-10-05', '2026-10-09')]
    const v = visitOf(orphan, [first, orphan], steps)
    expect(v).toMatchObject({
      step_id: null,
      start_date: null,
      end_date: null,
      ordinal: 2,
      total: 2,
    })
  })
})

describe('visitForDay', () => {
  const steps = [
    step('s1', 'z-tokyo', '2026-10-05', '2026-10-09', 1),
    step('s2', 'z-kyoto', '2026-10-09', '2026-10-12', 2),
  ]

  it.each([
    ['2026-10-06', 's1', 'an interior day belongs to the stay it is inside'],
    ['2026-10-09', 's2', 'a handover day belongs to the city you sleep in — the arrival'],
    ['2026-10-12', 's2', 'the last day belongs to the final stay, which has no later night'],
  ])('%s → %s (%s)', (day, expected) => {
    expect(visitForDay(steps, day)?.id).toBe(expected)
  })

  it('returns null for a day no stop covers', () => {
    expect(visitForDay(steps, '2026-10-01')).toBeNull()
  })
})

describe('visitForDay mirrors the client’s primaryStep', () => {
  // The client decides which zone a newly-added activity is filed under
  // (Schedule.tsx → primaryStep). The server decides which visit a day's
  // content belongs to. Those have to be the same rule, or an activity is
  // filed against one visit and linked to another.
  //
  // A copy is only honest if something notices when it drifts, so this runs
  // both over the same rows — including every handover, which is where they
  // could disagree — exactly as ordering.test.ts does for the datastore.
  const journeySteps = [
    step('s1', 'z-tokyo', '2026-10-05', '2026-10-09', 1),
    step('s2', 'z-kyoto', '2026-10-09', '2026-10-12', 2),
    step('s3', 'z-tokyo-2', '2026-10-12', '2026-10-14', 3),
  ]
  const tripSteps: TripStep[] = journeySteps.map((s) => ({
    id: s.id,
    position: s.position,
    start_date: s.start_date,
    end_date: s.end_date,
    zone: {
      id: s.zone_id,
      name: s.zone_id,
      name_ja: null,
      summary: null,
      place_counts: { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 },
    },
  }))

  const everyDay = [
    '2026-10-04', // before the first stop
    '2026-10-05',
    '2026-10-06',
    '2026-10-09', // handover: Tokyo ends, Kyoto begins
    '2026-10-11',
    '2026-10-12', // handover: Kyoto ends, the second Tokyo begins
    '2026-10-13',
    '2026-10-14', // the last day, no later night
    '2026-10-15', // after the last stop
  ]

  it.each(everyDay)('agrees on %s', (day) => {
    expect(visitForDay(journeySteps, day)?.id ?? null).toBe(primaryStep(tripSteps, day)?.id ?? null)
  })
})
