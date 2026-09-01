// The two scales, and the rule that decides which city the map opens on.
//
// No React here, and that is the test of the design as much as of the code:
// if either scale needed a render to be checked, the strategy would have leaked
// into the page (research R6).
import { describe, expect, it } from 'vitest'
import { defaultZoneId, savedIn, tripScope, zoneScope } from '../map/scope'
import type { Category, Activity, TripStep } from '../api/types'
import { activity } from './helpers'

const counts = (n: number) => ({ hotel: n, attraction: 0, food: 0, shopping: 0, other: 0 })

const zone = (id: string, name: string, lat: number | null, lng: number | null, saved = 0) => ({
  id,
  name,
  name_ja: null,
  summary: null,
  image_url: null,
  lat,
  lng,
  saved_counts: counts(saved),
})

const step = (
  id: string,
  position: number,
  start: string,
  end: string,
  z: ReturnType<typeof zone> | null
): TripStep => ({
  id,
  position,
  start_date: start,
  end_date: end,
  zone: z,
})

const place = (id: string, lat: number | null, lng: number | null): Activity =>
  activity({ id, name: `Place ${id}`, category: 'food', lat, lng })

const TOKYO = zone('zone-tokyo', 'Tokyo', 35.68, 139.76, 4)
const HAKONE = zone('zone-hakone', 'Hakone', 35.23, 139.02, 2)
const KYOTO = zone('zone-kyoto', 'Kyoto', 35.01, 135.76, 3)

const TRIP: TripStep[] = [
  step('s1', 1, '2026-10-01', '2026-10-05', TOKYO),
  step('s2', 2, '2026-10-05', '2026-10-08', HAKONE),
  step('s3', 3, '2026-10-08', '2026-10-14', KYOTO),
]

describe('zoneScope', () => {
  it('pins the located places and frames them', () => {
    const scope = zoneScope({
      zone: TOKYO,
      places: [place('a', 35.69, 139.7), place('b', null, null), place('c', 35.63, 139.79)],
      onPinTap: () => undefined,
    })
    expect(scope.kind).toBe('zone')
    expect(scope.pins.map((p) => p.id)).toEqual(['a', 'c'])
    expect(scope.bounds).toEqual({ south: 35.63, west: 139.7, north: 35.69, east: 139.79 })
  })

  it('gives a card to every pin and to nothing else', () => {
    const scope = zoneScope({
      zone: TOKYO,
      places: [place('a', 35.69, 139.7), place('b', null, null)],
      onPinTap: () => undefined,
    })
    // A card whose pin is not on the map is a row that scrolls to nothing.
    expect(scope.cards.map((c) => c.id)).toEqual(['a'])
    expect(scope.cards[0].subtitle).toBe('Food spot · Tokyo')
  })

  it('distinguishes an empty city from an unlocated one', () => {
    // Two different things to ask of the traveller: save something, or locate
    // what is already saved (FR-007's fourth scenario).
    expect(zoneScope({ zone: TOKYO, places: [], onPinTap: () => undefined }).emptyMessage).toBe(
      'Nothing saved in Tokyo yet.'
    )
    expect(
      zoneScope({ zone: TOKYO, places: [place('b', null, null)], onPinTap: () => undefined })
        .emptyMessage
    ).toBe('Nothing saved in Tokyo has a location yet.')
  })

  it('blames the chips, not the city, when the filter is what emptied it', () => {
    // `place()` here is always food, so a filter of anything else hides
    // everything. Saying "Nothing saved in Tokyo yet" over a city holding four
    // places is the map calling the traveller's own filter a missing trip.
    const scope = zoneScope({
      zone: TOKYO,
      places: [place('a', 35.69, 139.7), place('b', null, null)],
      active: new Set<Category>(['hotel']),
      onPinTap: () => undefined,
    })
    expect(scope.pins).toEqual([])
    expect(scope.emptyMessage).toBe('Nothing in Tokyo matches these filters.')
    // And the chips themselves still come from the whole city, so the one that
    // is hiding everything is still there to be turned back on.
    expect(scope.categories).toEqual(['food'])
  })

  it('asks for a location for what the filter is showing, not for the whole city', () => {
    const scope = zoneScope({
      zone: TOKYO,
      // Located, and filtered out; unlocated, and shown.
      places: [{ ...place('a', 35.69, 139.7), category: 'hotel' }, place('b', null, null)],
      active: new Set<Category>(['food']),
      onPinTap: () => undefined,
    })
    expect(scope.emptyMessage).toBe('Nothing matching these filters has a location yet.')
  })

  it('opens on the city itself when there is nothing to frame', () => {
    const scope = zoneScope({ zone: TOKYO, places: [], onPinTap: () => undefined })
    expect(scope.bounds).toBeNull()
    expect(scope.view.center).toEqual({ lat: 35.68, lng: 139.76 })
  })
})

describe('tripScope', () => {
  it('yields one pin per city, in the trip’s own order', () => {
    const scope = tripScope({ steps: TRIP, onPinTap: () => undefined })
    expect(scope.pins.map((p) => p.id)).toEqual(['zone-tokyo', 'zone-hakone', 'zone-kyoto'])
    expect(scope.kind).toBe('trip')
  })

  it('frames every stop', () => {
    const scope = tripScope({ steps: TRIP, onPinTap: () => undefined })
    expect(scope.bounds).toEqual({ south: 35.01, west: 135.76, north: 35.68, east: 139.76 })
  })

  it('carries how much is saved in each city, and no category swatch', () => {
    const scope = tripScope({ steps: TRIP, onPinTap: () => undefined })
    expect(scope.cards.map((c) => `${c.title}: ${c.subtitle}`)).toEqual([
      'Tokyo: 4 saved',
      'Hakone: 2 saved',
      'Kyoto: 3 saved',
    ])
    // At this scale the pin is a counted circle; a category dot beside a whole
    // city would be claiming something untrue.
    expect(scope.cards.every((c) => c.dot === null)).toBe(true)
  })

  it('drops a city with no coordinates rather than pinning it at (0, 0)', () => {
    const scope = tripScope({
      steps: [
        ...TRIP,
        step('s4', 4, '2026-10-14', '2026-10-15', zone('z-x', 'Nowhere', null, null)),
      ],
      onPinTap: () => undefined,
    })
    expect(scope.pins.map((p) => p.id)).not.toContain('z-x')
    expect(scope.cards.map((c) => c.id)).not.toContain('z-x')
  })

  it('returns the same shape the city scale does', () => {
    // This is the property the page depends on: it renders one shape and never
    // asks which scale it is on.
    expect(Object.keys(tripScope({ steps: TRIP, onPinTap: () => undefined })).sort()).toEqual(
      Object.keys(zoneScope({ zone: TOKYO, places: [], onPinTap: () => undefined })).sort()
    )
  })

  it('says so when the trip has no stops, and when none of them is located', () => {
    expect(tripScope({ steps: [], onPinTap: () => undefined }).emptyMessage).toMatch(/no stops yet/)
    expect(
      tripScope({
        steps: [step('s1', 1, '2026-10-01', '2026-10-05', zone('z-x', 'Nowhere', null, null))],
        onPinTap: () => undefined,
      }).emptyMessage
    ).toMatch(/has a location yet/)
  })
})

describe('savedIn', () => {
  it('adds up every category', () => {
    expect(
      savedIn({ saved_counts: { hotel: 1, attraction: 2, food: 3, shopping: 0, other: 1 } })
    ).toBe(7)
  })

  it('is zero for a city whose counts never arrived', () => {
    expect(savedIn({})).toBe(0)
  })
})

describe('defaultZoneId', () => {
  it('picks the step the trip is in the middle of', () => {
    expect(defaultZoneId(TRIP, '2026-10-06')).toBe('zone-hakone')
  })

  it('picks the next step before the trip starts', () => {
    expect(defaultZoneId(TRIP, '2026-09-20')).toBe('zone-tokyo')
  })

  it('falls back to the first stop once the trip is over', () => {
    expect(defaultZoneId(TRIP, '2026-12-25')).toBe('zone-tokyo')
  })

  it('reads the trip’s order, not the array’s', () => {
    const shuffled = [TRIP[2], TRIP[0], TRIP[1]]
    expect(defaultZoneId(shuffled, '2026-09-20')).toBe('zone-tokyo')
  })

  it('has no answer for a trip with no stops', () => {
    expect(defaultZoneId([], '2026-10-06')).toBeNull()
  })

  it('ignores a step whose zone was deleted', () => {
    const withHole = [step('s0', 0, '2026-09-01', '2026-09-30', null), ...TRIP]
    expect(defaultZoneId(withHole, '2026-09-15')).toBe('zone-tokyo')
  })
})
