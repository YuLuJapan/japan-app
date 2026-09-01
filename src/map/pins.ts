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
import { CATEGORY_META, type Category, type Activity } from '../api/types'

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
  /**
   * How much is saved here, when a pin stands for a city rather than a place.
   * Present only at the trip scale, where the pin is a counted cluster (2c's
   * treatment, carried forward from the reverted PR #93 — its visual answer
   * was right; its hand-rolled projection was not, because Leaflet owns that).
   */
  count?: number
}

/** A box to frame, in the only two axes a map has. */
export interface Bounds {
  south: number
  west: number
  north: number
  east: number
}

/** A place is pinnable only with both halves of a location. */
const located = (place: Pick<Activity, 'lat' | 'lng'>): boolean =>
  typeof place.lat === 'number' && typeof place.lng === 'number'

/**
 * One pin per located activity, in the order the list gave them.
 *
 * An untagged activity pins as `other`: the map draws a coloured mark per pin
 * and there is no "no colour" to draw. `CATEGORY_META.other` is the neutral
 * one the app already uses for exactly this ("More"), so nothing new is
 * invented here — and the row itself is left untagged, because the pin's
 * colour is a rendering choice and not a fact about the activity.
 */
export const toPins = (places: Activity[]): MapPin[] =>
  places.filter(located).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category ?? 'other',
    lat: p.lat as number,
    lng: p.lng as number,
  }))

/** How many of these places the map cannot show. The other half of SC-004. */
export const missingCount = (places: Activity[]): number =>
  places.length - places.filter(located).length

/** Exactly the places `toPins` dropped, for the list behind the count (FR-020). */
export const missingPlaces = (places: Activity[]): Activity[] => places.filter((p) => !located(p))

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

/** The smallest and largest a city cluster gets, in CSS pixels. */
const CLUSTER_MIN_PX = 34
const CLUSTER_STEP_PX = 2
const CLUSTER_CAP = 12

/**
 * How big a city's circle is: "sized by how much is saved there", which is the
 * one thing the trip scale says that a list of names does not.
 *
 * Capped, because the difference between 20 and 40 saved places is not worth a
 * circle that covers the next city — and the number is written inside it
 * anyway.
 */
export const clusterSize = (count: number): number =>
  CLUSTER_MIN_PX + Math.min(Math.max(count, 0), CLUSTER_CAP) * CLUSTER_STEP_PX

/** How a category is drawn, from the one table every other surface reads. */
export const categoryStyle = (category: Category) => ({
  dot: CATEGORY_META[category].dot,
  icon: CATEGORY_META[category].icon,
  label: CATEGORY_META[category].label,
})

/**
 * How far outside the frame counts as "here too" — beyond it, the traveller is
 * somewhere else. Padded by the frame's own size so a city map tolerates a
 * suburb and a single-pin map does not tolerate the next prefecture, with a
 * floor of roughly 5km for the case where every pin is on one street.
 */
const NEAR_FLOOR_DEG = 0.05

/**
 * The frame, once the traveller's own position is known — FR-025's rule, and
 * it lives here rather than in the component because it is arithmetic.
 *
 * A position **near** what is on screen widens the frame to include it, which
 * is the whole point of showing it: "near" should mean near you. A position
 * far away does not, because zooming out to span Kyoto and a hotel in Tel Aviv
 * shows neither. The saved places stay the subject; the locate button is how
 * the traveller goes to themselves instead.
 */
export function framedWith(
  bounds: Bounds | null,
  self: { lat: number; lng: number } | null
): Bounds | null {
  if (!bounds || !self) return bounds
  const padLat = Math.max(bounds.north - bounds.south, NEAR_FLOOR_DEG)
  const padLng = Math.max(bounds.east - bounds.west, NEAR_FLOOR_DEG)
  const near =
    self.lat >= bounds.south - padLat &&
    self.lat <= bounds.north + padLat &&
    self.lng >= bounds.west - padLng &&
    self.lng <= bounds.east + padLng
  if (!near) return bounds
  return {
    south: Math.min(bounds.south, self.lat),
    west: Math.min(bounds.west, self.lng),
    north: Math.max(bounds.north, self.lat),
    east: Math.max(bounds.east, self.lng),
  }
}
