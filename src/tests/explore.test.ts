// The rules behind "Explore, connected to the plan" (feature 010), tested on
// data rather than on a screen. Everything that can be got wrong lives in
// `src/lib/explore.ts`; the three screens above it only render what this says.
import { describe, expect, it } from 'vitest'
import type { Category, ItineraryItem, TripStep } from '../api/types'
import { cityPlan, plannedCounts, plannedLabel, tagZoneId } from '../lib/explore'
import { enumerateDays, zoneDays } from '../lib/schedule'

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
const tokyoDays = zoneDays(steps, 'z-tokyo', allDays)
const kyotoDays = zoneDays(steps, 'z-kyoto', allDays)

let n = 0
const item = (over: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id: `i${++n}`,
  trip_id: 'trip-1',
  zone_id: 'z-tokyo',
  place_id: null,
  day: '2026-10-06',
  start_time: null,
  title: `activity ${n}`,
  note: null,
  position: 0,
  highlight: false,
  icon: null,
  ...over,
})

const titles = (list: { title: string }[]) => list.map((a) => a.title)

describe('cityPlan — which activities belong to this city', () => {
  it('counts an activity pinned to this city on one of its days', () => {
    const plan = cityPlan(steps, [item({ category: 'food', title: 'ramen' })], tokyoDays, 'z-tokyo')
    expect(titles(plan.byCategory.food)).toEqual(['ramen'])
  })

  it('ignores an activity on a day this city is not visited', () => {
    // Oct 11 is Kyoto's; Tokyo's days stop at the shared Oct 9.
    const away = item({ zone_id: 'z-tokyo', day: '2026-10-11', category: 'food' })
    expect(cityPlan(steps, [away], tokyoDays, 'z-tokyo').byCategory.food).toEqual([])
  })

  it('gives each half of a shared day to the city it is pinned to', () => {
    const items = [
      item({ zone_id: 'z-tokyo', day: '2026-10-09', category: 'food', title: 'last breakfast' }),
      item({ zone_id: 'z-kyoto', day: '2026-10-09', category: 'food', title: 'first dinner' }),
    ]
    expect(titles(cityPlan(steps, items, tokyoDays, 'z-tokyo').byCategory.food)).toEqual([
      'last breakfast',
    ])
    expect(titles(cityPlan(steps, items, kyotoDays, 'z-kyoto').byCategory.food)).toEqual([
      'first dinner',
    ])
  })

  it('shows an activity pinned to no city on every city page whose days it falls in', () => {
    // Written before every activity carried a city. The Schedule shows it on
    // both pages of a shared day, so Explore must count it on both too.
    const loose = item({
      zone_id: null,
      day: '2026-10-09',
      category: 'attraction',
      title: 'museum',
    })
    expect(titles(cityPlan(steps, [loose], tokyoDays, 'z-tokyo').byCategory.attraction)).toEqual([
      'museum',
    ])
    expect(titles(cityPlan(steps, [loose], kyotoDays, 'z-kyoto').byCategory.attraction)).toEqual([
      'museum',
    ])
  })

  it('agrees with the Schedule on a city page, which is the point', () => {
    // Every activity of one day, mixed: this city's, the other city's, and a
    // loose one. What Explore counts is what the page's own plan shows.
    const items = [
      item({ zone_id: 'z-tokyo', day: '2026-10-09', category: 'food', title: 'mine' }),
      item({ zone_id: 'z-kyoto', day: '2026-10-09', category: 'food', title: 'theirs' }),
      item({ zone_id: null, day: '2026-10-09', category: 'food', title: 'loose' }),
    ]
    expect(titles(cityPlan(steps, items, tokyoDays, 'z-tokyo').byCategory.food)).toEqual([
      'mine',
      'loose',
    ])
  })
})

describe('cityPlan — which tag', () => {
  it('prefers the typed tag over the one derived from a linked place', () => {
    const typed = item({ category: 'food', place_category: 'attraction', place_id: 'p1' })
    const plan = cityPlan(steps, [typed], tokyoDays, 'z-tokyo')
    expect(plan.byCategory.food).toHaveLength(1)
    expect(plan.byCategory.attraction).toEqual([])
  })

  it('falls back to the linked place category', () => {
    const derived = item({ category: null, place_category: 'attraction', place_id: 'p1' })
    expect(cityPlan(steps, [derived], tokyoDays, 'z-tokyo').byCategory.attraction).toHaveLength(1)
  })

  it('ignores an untagged activity and never tags one "other"', () => {
    const items = [item({ category: null }), item({ category: 'other' as Category })]
    const plan = cityPlan(steps, items, tokyoDays, 'z-tokyo')
    expect(plannedCounts(plan)).toEqual({ hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 })
  })

  it('drops a category this member may not see', () => {
    // The server already nulls place_id (and so place_category) on a withheld
    // stay; what it leaves alone is the traveller's own typed tag, and that
    // alone would grow a "0 saved · 1 planned" Stays card. See research R3.
    const typedStay = item({ category: 'hotel', title: 'check in' })
    expect(cityPlan(steps, [typedStay], tokyoDays, 'z-tokyo').byCategory.hotel).toHaveLength(1)
    expect(cityPlan(steps, [typedStay], tokyoDays, 'z-tokyo', ['hotel']).byCategory.hotel).toEqual(
      []
    )
  })
})

describe('cityPlan — order and grouping', () => {
  it('orders by day, then timed before untimed, then position', () => {
    const items = [
      item({
        day: '2026-10-07',
        start_time: null,
        position: 0,
        category: 'food',
        title: 'anytime',
      }),
      item({
        day: '2026-10-07',
        start_time: '19:00',
        position: 0,
        category: 'food',
        title: 'late',
      }),
      item({ day: '2026-10-06', start_time: null, position: 1, category: 'food', title: 'second' }),
      item({ day: '2026-10-06', start_time: null, position: 0, category: 'food', title: 'first' }),
    ]
    expect(titles(cityPlan(steps, items, tokyoDays, 'z-tokyo').byCategory.food)).toEqual([
      'first',
      'second',
      'late',
      'anytime',
    ])
  })

  it('groups the activities that link to a saved place, in the same order', () => {
    const items = [
      item({ day: '2026-10-08', category: 'food', place_id: 'p1', title: 'dinner again' }),
      item({ day: '2026-10-06', category: 'food', place_id: 'p1', title: 'lunch' }),
      item({ day: '2026-10-06', category: 'food', place_id: 'p2', title: 'elsewhere' }),
    ]
    const { byPlace } = cityPlan(steps, items, tokyoDays, 'z-tokyo')
    expect(titles(byPlace.get('p1') ?? [])).toEqual(['lunch', 'dinner again'])
    expect(titles(byPlace.get('p2') ?? [])).toEqual(['elsewhere'])
    expect(byPlace.get('p3')).toBeUndefined()
  })

  it('cannot mark a place whose link the server cut off', () => {
    // A withheld stay arrives with place_id null and no derived category.
    const cut = item({ category: null, place_category: null, place_id: null })
    const { byPlace } = cityPlan(steps, [cut], tokyoDays, 'z-tokyo')
    expect(byPlace.size).toBe(0)
  })

  it('returns empty answers rather than undefined for an empty trip', () => {
    const plan = cityPlan([], [], [], 'z-tokyo')
    expect(plannedCounts(plan)).toEqual({ hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 })
    expect(plan.byPlace.size).toBe(0)
  })
})

describe('plannedCounts', () => {
  it('counts activities, not distinct places', () => {
    // Two dinners at one ramen shop are two planned things and one saved thing.
    const items = [
      item({ category: 'food', place_id: 'p1' }),
      item({ category: 'food', place_id: 'p1' }),
      item({ category: 'shopping' }),
    ]
    const counted = plannedCounts(cityPlan(steps, items, tokyoDays, 'z-tokyo'))
    expect(counted.food).toBe(2)
    expect(counted.shopping).toBe(1)
    expect(counted.other).toBe(0)
  })
})

describe('plannedLabel', () => {
  const at = (day: string, start_time: string | null, title = 't') => ({
    id: title,
    title,
    day,
    start_time,
    position: 0,
    category: 'food' as Category,
    place_id: 'p1',
    zone_id: 'z-tokyo',
  })

  it('says nothing about a place nothing links to', () => {
    expect(plannedLabel(undefined)).toBeNull()
    expect(plannedLabel([])).toBeNull()
  })

  it('names the day, and the time when there is one', () => {
    expect(plannedLabel([at('2026-10-08', null)])).toBe('Planned Thu, Oct 8')
    expect(plannedLabel([at('2026-10-08', '19:00')])).toBe('Planned Thu, Oct 8, 7:00 PM')
  })

  it('names the first and counts the rest', () => {
    expect(plannedLabel([at('2026-10-06', null, 'a'), at('2026-10-08', null, 'b')])).toBe(
      'Planned Tue, Oct 6 + 1 more'
    )
  })
})

describe('tagZoneId', () => {
  it('uses the activity own city whenever it has one', () => {
    expect(tagZoneId({ zone_id: 'z-kyoto' }, 'z-tokyo', false)).toBe('z-kyoto')
    expect(tagZoneId({ zone_id: 'z-kyoto' }, 'z-tokyo', true)).toBe('z-kyoto')
  })

  it("falls back to the screen's city when the day is not shared", () => {
    expect(tagZoneId({ zone_id: null }, 'z-tokyo', false)).toBe('z-tokyo')
  })

  it('refuses to guess on a shared day', () => {
    expect(tagZoneId({ zone_id: null }, 'z-tokyo', true)).toBeNull()
    expect(tagZoneId({ zone_id: null }, null, false)).toBeNull()
  })
})
