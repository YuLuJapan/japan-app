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
import { boundsOf, missingPlaces, toPins } from './pins'
import type { MapView } from './engine.types'
import {
  CATEGORIES,
  CATEGORY_META,
  type Category,
  type PlaceListItem,
  type TripStep,
} from '../api/types'

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
  /** The glyph that sits inside `dot`'s circle, or null alongside it. */
  icon: string | null
  /**
   * What is behind the card, when something is: a place. It carries its own
   * coordinates so the directions link aims at the doorway rather than at a
   * text search for a namesake (research R10).
   */
  place?: {
    category: Category
    address: string | null
    summary: string
    lat: number | null
    lng: number | null
  }
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
  /**
   * The categories this scale can be filtered and legended by, in the app's
   * own order — and **empty is the answer, not an oversight**. A trip pin is a
   * city, not a place: it has no category, so a chip row would filter nothing
   * and a legend would name colours that are not on the screen. Both surfaces
   * render from this one field, so "the filters belong to the city scale" is a
   * property of the scale rather than a pair of `scope.kind` checks in the
   * page (research R6).
   */
  categories: Category[]
  /**
   * Exactly what this scale could not put on the map, for US5's line to state
   * and list (FR-019, FR-020). Empty at the trip scale, where a pin is a city
   * and every stop is either located or not a stop the map claims to show —
   * which is what keeps the page from asking which scale it is on to decide
   * whether to render the line at all.
   */
  missing: PlaceListItem[]
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
 * The empty message distinguishes the ways a city map can be blank, because
 * they ask different things of the traveller: an empty city wants places
 * saved, a city whose places have no coordinates wants them located (FR-007's
 * fourth scenario) — and a city emptied by the chips wants nothing at all,
 * only to say so, because the traveller did that themselves and the `All` chip
 * is directly above the line.
 */
export function zoneScope({
  zone,
  places,
  active = null,
  onPinTap,
}: {
  zone: { name: string; lat?: number | null; lng?: number | null }
  /** Every place saved in the city, unfiltered — the filter is applied here. */
  places: PlaceListItem[]
  /** Null means every category — the `All` state, not a full selection. */
  active?: Set<Category> | null
  onPinTap: (placeId: string) => void
}): MapScope {
  // Only the categories actually present are offered (FR-010), in the app's
  // own order rather than the order the places happen to arrive in. Read from
  // the whole city, never from the filtered list — otherwise switching a chip
  // off would take its own chip away with it.
  const categories = CATEGORIES.filter((c) => places.some((p) => p.category === c))
  const shown = active ? places.filter((p) => active.has(p.category)) : places
  const pins = toPins(shown)
  const located = new Set(pins.map((p) => p.id))
  return {
    kind: 'zone',
    pins,
    bounds: boundsOf(pins),
    view: viewOf(zone, CITY_ZOOM),
    // Only the located places get a card: a card whose pin is not on the map
    // is a row that scrolls to nothing. The ones without a location are
    // counted and listed by `MissingPlaces` instead (FR-019).
    cards: shown.filter((p) => located.has(p.id)).map((p) => placeCard(p, zone.name)),
    // Over the *shown* places, not over every place in the city: the identity
    // that keeps the count honest is `pins on screen + missing = what this
    // member can see in this view` (SC-004), and a filtered view is still a view.
    missing: missingPlaces(shown),
    categories,
    emptyMessage: emptyMessageFor(zone.name, places, shown),
    onPinTap,
  }
}

/**
 * Why the city map is blank — four answers, because the traveller's next move
 * differs in each and a wrong one sends them looking for a bug.
 *
 * The filtered cases are the point of the split: `Nothing saved in Tokyo yet`
 * over a city holding forty places, hidden by a chip the traveller turned off
 * a moment ago, is the map calling their own filter a missing trip. Read only
 * when there is no pin on screen.
 */
const emptyMessageFor = (
  name: string,
  /** Every place saved in the city. */
  places: PlaceListItem[],
  /** What survived the chips. */
  shown: PlaceListItem[]
): string => {
  if (!places.length) return `Nothing saved in ${name} yet.`
  if (!shown.length) return `Nothing in ${name} matches these filters.`
  // Something is showing and none of it is on the map, so what is wanted is a
  // location — for the filtered view when the chips are narrowing it, since
  // claiming it of the whole city would be claiming more than was looked at.
  return shown.length === places.length
    ? `Nothing saved in ${name} has a location yet.`
    : `Nothing matching these filters has a location yet.`
}

/** A place, as the card row draws it. */
const placeCard = (place: PlaceListItem, zoneName: string): MapCard => ({
  id: place.id,
  title: place.name,
  subtitle: `${CATEGORY_META[place.category].singular} · ${zoneName}`,
  dot: CATEGORY_META[place.category].dot,
  icon: CATEGORY_META[place.category].icon,
  place: {
    category: place.category,
    address: place.address ?? null,
    summary: place.summary_line,
    lat: place.lat ?? null,
    lng: place.lng ?? null,
  },
})

/** The whole trip, once a map has been asked to show it. Overridden by `bounds`. */
const COUNTRY_ZOOM = 6

/**
 * The whole journey: one pin per city, in the order the trip visits them.
 *
 * Fed entirely from the trip bundle's `steps[].zone`, which already carries
 * every zone row with its coordinates — so this scale needs **no request of its
 * own** and worked on day one, before a single place had been located
 * (contracts §2).
 *
 * **It does not plot individual places, deliberately** (FR-008): the trip spans
 * roughly 500km, and at a zoom that fits it on a phone every place in a city
 * lands within a few pixels of every other. Tapping a city switches the page to
 * that city's `zoneScope`, which is the second of the two taps every place
 * stays behind.
 *
 * A city with no coordinates is dropped from the pins rather than pinned at
 * (0, 0) — the same rule `toPins` applies to places, for the same reason.
 */
export function tripScope({
  steps,
  onPinTap,
}: {
  steps: TripStep[]
  onPinTap: (zoneId: string) => void
}): MapScope {
  const zones = steps
    .map((step) => step.zone)
    .filter((zone): zone is NonNullable<TripStep['zone']> => zone !== null)
  const byId = new Map(zones.map((zone) => [zone.id, zone]))
  const pins = toPins(
    zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      // Every zone pin is drawn as a counted cluster rather than by category,
      // so the category here is only what keeps the shape one shape.
      category: 'other' as Category,
      name_ja: null,
      summary_line: '',
      address: null,
      lat: zone.lat ?? null,
      lng: zone.lng ?? null,
    }))
    // By id, not by index: `toPins` drops the cities with no coordinates, so
    // the two arrays stop lining up exactly where it matters most.
  ).map((pin) => ({ ...pin, count: savedIn(byId.get(pin.id) ?? {}) }))
  const located = new Set(pins.map((p) => p.id))
  return {
    kind: 'trip',
    pins,
    bounds: boundsOf(pins),
    view: viewOf(zones[0] ?? {}, COUNTRY_ZOOM),
    cards: zones.filter((z) => located.has(z.id)).map(cityCard),
    missing: [],
    // No chips and no legend at this scale: see `MapScope.categories`.
    categories: [],
    emptyMessage: zones.length
      ? 'None of this trip’s stops has a location yet.'
      : 'This trip has no stops yet.',
    onPinTap,
  }
}

/** How much is saved in a city — the number its cluster carries. */
export const savedIn = (zone: { place_counts?: Record<Category, number> }): number =>
  Object.values(zone.place_counts ?? {}).reduce((total, n) => total + n, 0)

/** A city, as the trip scale's card row draws it. */
const cityCard = (zone: NonNullable<TripStep['zone']>): MapCard => {
  const saved = savedIn(zone)
  return {
    id: zone.id,
    title: zone.name,
    subtitle: `${saved} saved`,
    // No dot and no icon: at this scale the pin itself is a counted circle,
    // and a category glyph beside a whole city would be claiming something
    // untrue.
    dot: null,
    icon: null,
  }
}

/**
 * Which city the map opens on: the current journey step's zone, the next one
 * before the trip starts, and the first when there is no answer either way
 * (FR-008).
 *
 * A pure function of the steps and today's date, so the rule is testable
 * without a clock, a router or a render. Dates are compared as the `YYYY-MM-DD`
 * strings they are stored as — the same comparison every other range rule in
 * the app makes, and one that has no timezone in it to get wrong.
 */
export function defaultZoneId(steps: TripStep[], today: string): string | null {
  const withZone = steps.filter((step) => step.zone).sort((a, b) => a.position - b.position)
  if (!withZone.length) return null
  const current = withZone.find((s) => s.start_date <= today && today <= s.end_date)
  if (current) return current.zone!.id
  const next = withZone.find((s) => s.start_date > today)
  // Past the end of the trip there is no "next", and the first stop is the one
  // the journey is still told from.
  return (next ?? withZone[0]).zone!.id
}
