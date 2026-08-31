// What is *planned* in one city, per category — the half of Explore that the
// city page threw away until now (feature 010).
//
// Explore counted saved places; the day plan tagged activities; the two never
// met. Everything the connection needs is already on the device — the trip's
// steps, the trip's whole plan and the zone's saved counts are all fetched by
// the city page for its hero and its Schedule — so this is a reading of data in
// hand rather than an endpoint (research R1). It is a pure module for the same
// reason `src/map/pins.ts` is: every rule below can be got wrong, and getting
// them right once here is what keeps the three screens above thin enough to
// review by reading.
//
// Three rules, and the first is the load-bearing one:
//
//  1. **Whose city is this activity in?** — `daySections(…, zoneId)`, the exact
//     call the Schedule on that same page makes. FR-003 asks that Explore and
//     the Schedule can never disagree; running the same function is the only
//     way to guarantee that rather than hope for it. It also settles the two
//     awkward cases for free: a day two cities share counts each activity in
//     the city it is pinned to, and an activity pinned to no city (written
//     before every activity had one) shows on every city page whose days it
//     falls in.
//  2. **Which tag?** — `category ?? place_category`, the same precedence the
//     day plan draws: if the traveller typed one, they meant it. `other` is not
//     a tag (it has no colour in `CATEGORY_META`) and neither is "none".
//  3. **What may this member see?** — `hidden`. Most of this is already settled
//     server-side: `listItinerary` nulls `place_id` on an activity pointing at
//     a stay this caller may not see, and `place_category` is derived from
//     `place_id`, so a withheld stay arrives with no derived tag at all. What
//     the server deliberately leaves alone is the traveller's *typed*
//     `category: 'hotel'` — it is their own word, attached to no place — and
//     that alone would grow a "0 saved · 1 planned" Stays card on a restricted
//     member's grid. `hidden` is the one client-side half of that rule, and it
//     lives here rather than in two pages so it is testable on data (R3).
import type { Category, ItineraryItem, TripStep } from '../api/types'
import { CATEGORIES } from '../api/types'
import { compareItinerary } from './ordering'
import { daySections, fmtDayLong, fmtTime } from './schedule'

/**
 * One activity of a city's plan, reduced to what Explore renders. A projection
 * of `ItineraryItem`, not a new kind of thing — nothing here is stored.
 */
export interface PlannedActivity {
  id: string
  title: string
  day: string
  start_time: string | null
  /** Carried only so the plan's own comparator can order these rows. */
  position: number
  /** Resolved and narrowed: one of the four taggable categories, never `other`. */
  category: Category
  /** Where the row links, or null once the server has cut a withheld stay's link. */
  place_id: string | null
  zone_id: string | null
}

/** What one pass over the trip's plan produces for one city. */
export interface ExplorePlan {
  /** The planned band per category, in plan order. `other` is always empty. */
  byCategory: Record<Category, PlannedActivity[]>
  /** Per saved place, the activities in this city that link to it, in plan order. */
  byPlace: Map<string, PlannedActivity[]>
}

const emptyByCategory = (): Record<Category, PlannedActivity[]> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, [] as PlannedActivity[]])) as Record<
    Category,
    PlannedActivity[]
  >

/**
 * The categories this member's view withholds, in the shape `cityPlan` takes.
 * One function rather than the same ternary on two pages: it is a privacy rule,
 * and a privacy rule written twice is a privacy rule that will differ once.
 */
export function hiddenCategories(shows: { stays: boolean }): Category[] {
  return shows.stays ? [] : ['hotel']
}

/**
 * What is planned in one city.
 *
 * @param steps  the trip's journey steps, as the trip bundle returns them
 * @param items  **the whole trip's** activities, unfiltered — the filtering is the job
 * @param days   this city's own days (`zoneDays(...)`)
 * @param zoneId the city being looked at
 * @param hidden categories this member may not see; `['hotel']` for a view without stays
 */
export function cityPlan(
  steps: TripStep[],
  items: ItineraryItem[],
  days: string[],
  zoneId: string,
  hidden: readonly Category[] = []
): ExplorePlan {
  const byCategory = emptyByCategory()
  const byPlace = new Map<string, PlannedActivity[]>()

  for (const day of days) {
    // One band on a city page, always — `daySections` folds the city's own half
    // of a shared day into it, which is the whole point of asking it rather
    // than filtering on `zone_id` here.
    const mine = daySections(
      steps,
      day,
      items.filter((i) => i.day === day),
      zoneId
    )[0]
    for (const item of mine?.items ?? []) {
      const category = item.category ?? item.place_category ?? null
      // `other` is not a tag: `CATEGORY_META` has no colour for it, and an
      // unreadable pill is not a tag (the same rule the activity form applies).
      if (!category || category === 'other' || hidden.includes(category)) continue
      const planned: PlannedActivity = {
        id: item.id,
        title: item.title,
        day: item.day,
        start_time: item.start_time,
        position: item.position,
        category,
        place_id: item.place_id,
        zone_id: item.zone_id,
      }
      byCategory[category].push(planned)
      if (planned.place_id) {
        const already = byPlace.get(planned.place_id)
        if (already) already.push(planned)
        else byPlace.set(planned.place_id, [planned])
      }
    }
  }

  // The plan's own order, borrowed rather than restated: timed before untimed,
  // then position. `days` is already in date order, but an activity can be
  // reached through two steps of a revisited city, so sort rather than assume.
  for (const category of CATEGORIES) byCategory[category].sort(compareItinerary)
  for (const list of byPlace.values()) list.sort(compareItinerary)

  return { byCategory, byPlace }
}

/** The grid's second number. `other` is always 0 — it carries no tag. */
export function plannedCounts(plan: ExplorePlan): Record<Category, number> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, plan.byCategory[c].length])) as Record<
    Category,
    number
  >
}

/**
 * The marker on a saved row — "we already have a day for this". Null when
 * nothing links to the place, so a saved place nobody planned is untouched and
 * the caller writes no conditional of its own.
 */
export function plannedLabel(activities: PlannedActivity[] | undefined): string | null {
  if (!activities || activities.length === 0) return null
  // The first is the earliest: `cityPlan` sorted them.
  const [first, ...rest] = activities
  const when = first.start_time
    ? `${fmtDayLong(first.day)}, ${fmtTime(first.start_time)}`
    : fmtDayLong(first.day)
  return rest.length > 0 ? `Planned ${when} + ${rest.length} more` : `Planned ${when}`
}

/**
 * The city an activity's tag should open, or null when it cannot be told.
 *
 * `ambiguous` is the screen's own existing admission that it does not know: the
 * trip screen sets `zoneChoices` only on a day two cities share, which is why
 * the add form asks there instead of guessing. Falling back to `primaryStep`
 * would reintroduce exactly the mis-stamping that question was added to end —
 * it answers "the city you sleep in", which on a moving day is the one you are
 * flying into, not the one you spent the morning in (research R6).
 */
export function tagZoneId(
  item: Pick<ItineraryItem, 'zone_id'>,
  fallbackZoneId: string | null,
  ambiguous: boolean
): string | null {
  if (item.zone_id) return item.zone_id
  return ambiguous ? null : fallbackZoneId
}
