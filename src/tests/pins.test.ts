// The projection from places to pins, with no React and no Leaflet in sight.
//
// The arithmetic in the middle of this file is the one that proves the map is
// not quietly under-reporting: `pins.length + missingCount === places.length`,
// for any array (SC-004). It holds because both functions walk the same list —
// which is why they live in one module and are tested together rather than
// apart.
import { describe, expect, it } from 'vitest'
import { boundsOf, categoryStyle, missingCount, toPins } from '../map/pins'
import type { PlaceListItem } from '../api/types'

const place = (id: string, lat: number | null, lng: number | null): PlaceListItem => ({
  id,
  name: `Place ${id}`,
  name_ja: null,
  category: 'food',
  summary_line: '',
  image_url: null,
  address: null,
  lat,
  lng,
})

const MIXED: PlaceListItem[] = [
  place('a', 35.66, 139.7),
  place('b', null, null),
  place('c', 34.99, 135.77),
  place('d', 35.01, null), // half a location is no location
  place('e', null, 139.5),
]

describe('toPins', () => {
  it('drops a place with no latitude or no longitude', () => {
    expect(toPins(MIXED).map((p) => p.id)).toEqual(['a', 'c'])
  })

  it('carries only what a pin needs', () => {
    expect(toPins([place('a', 35.66, 139.7)])[0]).toEqual({
      id: 'a',
      name: 'Place a',
      category: 'food',
      lat: 35.66,
      lng: 139.7,
    })
  })

  it('is empty for an empty list', () => {
    expect(toPins([])).toEqual([])
  })
})

describe('missingCount', () => {
  it('counts exactly the places that could not be pinned', () => {
    expect(missingCount(MIXED)).toBe(3)
  })

  it('and the two always add up to the whole list (SC-004)', () => {
    // The property, not an example: a place is pinned or counted, never both
    // and never neither. This is what makes the count on screen honest.
    expect(toPins(MIXED).length + missingCount(MIXED)).toBe(MIXED.length)
    expect(toPins([]).length + missingCount([])).toBe(0)
  })
})

describe('boundsOf', () => {
  it('frames every pin', () => {
    const bounds = boundsOf(toPins(MIXED))
    expect(bounds).toEqual({ south: 34.99, west: 135.77, north: 35.66, east: 139.7 })
  })

  it('frames a single pin as a point', () => {
    expect(boundsOf(toPins([place('a', 35.66, 139.7)]))).toEqual({
      south: 35.66,
      west: 139.7,
      north: 35.66,
      east: 139.7,
    })
  })

  it('is null when there is nothing to frame', () => {
    // Not a zero box at (0, 0) in the Gulf of Guinea — "nothing to show" is a
    // different answer from "show this", and the caller has to be able to tell.
    expect(boundsOf([])).toBeNull()
  })
})

describe('categoryStyle', () => {
  it('gives every category its own fill, from the one table', () => {
    const dots = ['hotel', 'attraction', 'food', 'shopping', 'other'].map(
      (c) => categoryStyle(c as never).dot
    )
    expect(new Set(dots).size).toBe(5)
  })
})
