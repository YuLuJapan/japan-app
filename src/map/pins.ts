// Places → pins, and the arithmetic that keeps the map honest.
//
// Pure: no React, no Leaflet, no DOM. Everything the map screen would
// otherwise do inside a `useMemo` lives here as a named function, which is
// what keeps the components thin enough to be worth the name.
//
// **`toPins` and `missingCount` walk the same array on purpose.** A pin exists
// only for a place that has both coordinates; every other place is counted and
// stated (FR-019). Because both read one list under one rule,
// `pins.length + missingCount === places.length` cannot drift — that identity
// is SC-004, and it is the number that proves the map is not quietly
// under-reporting what was saved.
import { CATEGORY_META, type Category, type PlaceListItem } from '../api/types'

/**
 * What the engine draws. Deliberately narrower than a place: a pin carries no
 * description, no links and no address, because everything else belongs to the
 * sheet, which reads the place the list already handed it.
 */
export interface MapPin {
  id: string
  name: string
  category: Category
  /** Never null — a pin cannot exist without a location. */
  lat: number
  lng: number
}

/** A box to frame, in the only two axes a map has. */
export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

/** A place is pinnable only with both halves of a location. */
const located = (place: Pick<PlaceListItem, 'lat' | 'lng'>): boolean =>
  typeof place.lat === 'number' && typeof place.lng === 'number'

/** One pin per located place, in the order the list gave them. */
export const toPins = (places: PlaceListItem[]): MapPin[] =>
  places.filter(located).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    lat: p.lat as number,
    lng: p.lng as number,
  }))

/** How many of these places the map cannot show. The other half of SC-004. */
export const missingCount = (places: PlaceListItem[]): number =>
  places.length - places.filter(located).length

/** Exactly the places `toPins` dropped, for the list behind the count (FR-020). */
export const missingPlaces = (places: PlaceListItem[]): PlaceListItem[] =>
  places.filter((p) => !located(p))

/**
 * The smallest box containing every pin, or `null` when there is nothing to
 * frame.
 *
 * Null rather than a zero box: an empty list framed at (0, 0) puts the map in
 * the Gulf of Guinea, and "nothing to show" is a different answer from "show
 * this" that the caller has to be able to tell apart.
 */
export function boundsOf(pins: MapPin[]): Bounds | null {
  if (!pins.length) return null
  const lats = pins.map((p) => p.lat)
  const lngs = pins.map((p) => p.lng)
  return {
    south: Math.min(...lats),
    west: Math.min(...lngs),
    north: Math.max(...lats),
    east: Math.max(...lngs),
  }
}

/** How a category is drawn, from the one table every other surface reads. */
export const categoryStyle = (category: Category) => ({
  dot: CATEGORY_META[category].dot,
  label: CATEGORY_META[category].label,
})
