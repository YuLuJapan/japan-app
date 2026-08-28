// The two scales, as data rather than as a branch.
//
// The trip spans about 500km, so one flat map puts every pin at a useless
// zoom — which is why there are two scales at all (FR-008). But the two differ
// in four places: what the pins are, how they are framed, what an empty view
// says, and what tapping one does. Written as `if (scope === 'trip')` that
// single decision spreads across the render, the bounds maths and the handler.
//
// Written as two functions returning one shape, `TripMap.tsx` renders without
// ever asking which scale it is on, and each scale is unit-testable with no
// React at all (research R6). **If a `scope.kind === …` appears anywhere but
// the toggle itself, the strategy has leaked.**
//
// `view` is one field beyond the shape data-model.md names, and it is here for
// a reason worth stating: a map with nothing to frame still has to mount
// somewhere, and "where" is a property of the scale — a zone's own
// coordinates, or the whole trip's. Left to the component it would have been
// the fifth difference, and the first `if`.
import type { Bounds, MapPin } from './pins'
import { boundsOf, toPins } from './pins'
import type { MapView } from './engine.types'
import { CATEGORY_META, type Category, type PlaceListItem } from '../api/types'

/**
 * One row of the sheet's card row, at either scale.
 *
 * A card is built by the scale that produced it, so the row renders one shape:
 * a place at the city scale, a city at the trip scale. `place` is what a card
 * carries only when there is something behind it to open — which is what US3's
 * expanded card reads, and what keeps `PlaceCardRow` from asking which scale
 * it is drawing.
 */
export interface MapCard {
  id: string
  title: string
  /** The quieter second line: `Stay · Tokyo`, or `4 saved`. */
  subtitle: string
  /** A `CATEGORY_META.dot` class, or null where the pin itself carries the count. */
  dot: string | null
  place?: { category: Category; address: string | null; summary: string }
}

/** One shape, whichever scale produced it. */
export interface MapScope {
  kind: 'zone' | 'trip'
  pins: MapPin[]
  /** Null when there is nothing to frame; the caller falls back to `view`. */
  bounds: Bounds | null
  /** Where to open when `bounds` is null. */
  view: MapView
  /** One card per pin, in the same order. */
  cards: MapCard[]
  /** What to say when `pins` is empty. Only ever read then. */
  emptyMessage: string
  onPinTap: (id: string) => void
}

/** A city, once a map has been asked to show one. */
const CITY_ZOOM = 12

/**
 * Nothing to frame and nothing to centre on. Reached only when a zone carries
 * no coordinates *and* holds no located place — in which case the traveller is
 * reading `emptyMessage`, not the map.
 */
const NOWHERE_IN_PARTICULAR: MapView = { center: { lat: 20, lng: 0 }, zoom: 2 }

const viewOf = (place: { lat?: number | null; lng?: number | null }, zoom: number): MapView =>
  typeof place.lat === 'number' && typeof place.lng === 'number'
    ? { center: { lat: place.lat, lng: place.lng }, zoom }
    : NOWHERE_IN_PARTICULAR

/**
 * One city's saved places.
 *
 * The empty message distinguishes the two ways a city map can be blank,
 * because they ask different things of the traveller: an empty zone wants
 * places saved, a zone whose places have no coordinates wants them located
 * (FR-007's fourth scenario).
 */
export function zoneScope({
  zone,
  places,
  onPinTap,
}: {
  zone: { name: string; lat?: number | null; lng?: number | null }
  places: PlaceListItem[]
  onPinTap: (placeId: string) => void
}): MapScope {
  const pins = toPins(places)
  const located = new Set(pins.map((p) => p.id))
  return {
    kind: 'zone',
    pins,
    bounds: boundsOf(pins),
    view: viewOf(zone, CITY_ZOOM),
    // Only the located places get a card: a card whose pin is not on the map
    // is a row that scrolls to nothing. The ones without a location are
    // counted and listed by `MissingPlaces` instead (FR-019).
    cards: places.filter((p) => located.has(p.id)).map((p) => placeCard(p, zone.name)),
    emptyMessage: places.length
      ? `Nothing saved in ${zone.name} has a location yet.`
      : `Nothing saved in ${zone.name} yet.`,
    onPinTap,
  }
}

/** A place, as the card row draws it. */
const placeCard = (place: PlaceListItem, zoneName: string): MapCard => ({
  id: place.id,
  title: place.name,
  subtitle: `${CATEGORY_META[place.category].singular} · ${zoneName}`,
  dot: CATEGORY_META[place.category].dot,
  place: {
    category: place.category,
    address: place.address ?? null,
    summary: place.summary_line,
  },
})
