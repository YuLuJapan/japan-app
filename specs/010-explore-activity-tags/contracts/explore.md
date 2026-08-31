# Contract: `src/lib/explore.ts`

This feature adds **no HTTP contract** — no endpoint is added, changed or deprecated, so
`specs/001-japan-trip-app/contracts/api.md` is untouched. The interface worth pinning down is the pure
module the three screens share, in the same spirit as `src/map/pins.ts` and `src/map/scope.ts`: data in,
data out, no DOM, no hooks, no router.

## Exports

```ts
import type { Category, ItineraryItem, TripStep } from '../api/types'

export interface PlannedActivity {
  id: string
  title: string
  day: string
  start_time: string | null
  /** Carried only so `compareItinerary` can order these rows. */
  position: number
  category: Category
  place_id: string | null
  zone_id: string | null
}

export interface ExplorePlan {
  byCategory: Record<Category, PlannedActivity[]>
  byPlace: Map<string, PlannedActivity[]>
}

/** What is planned in one city, from the trip's whole plan. */
export function cityPlan(
  steps: TripStep[],
  items: ItineraryItem[],
  days: string[],
  zoneId: string,
  hidden?: readonly Category[]
): ExplorePlan

/** The grid's second number, per category. */
export function plannedCounts(plan: ExplorePlan): Record<Category, number>

/** The marker on a saved row, or null when nothing links to it. */
export function plannedLabel(activities: PlannedActivity[] | undefined): string | null

/** The city an activity's tag should open, or null when it cannot be told. */
export function tagZoneId(
  item: Pick<ItineraryItem, 'zone_id'>,
  fallbackZoneId: string | null,
  ambiguous: boolean
): string | null

/** The categories this member's view withholds, in the shape `cityPlan` takes. */
export function hiddenCategories(shows: { stays: boolean }): Category[]
```

`hiddenCategories` exists so the one privacy rule is written once rather than as the same ternary on
three screens; all three call sites pass `useTripShows()` straight into it.

## `cityPlan`

| Parameter | Contract                                                                                  |
| --------- | ----------------------------------------------------------------------------------------- |
| `steps`   | the trip's journey steps, as the trip bundle returns them. May be empty.                  |
| `items`   | **the whole trip's** activities, unfiltered. The function does the filtering.             |
| `days`    | the city's own days — `zoneDays(steps, zoneId, enumerateDays(start, end))`. May be empty. |
| `zoneId`  | the city being looked at. Required; there is no "whole trip" mode.                        |
| `hidden`  | categories this member may not see. Defaults to `[]`.                                     |

**Guarantees**

1. An activity is included exactly when `daySections(steps, day, <that day's items>, zoneId)` puts it in
   this city's band — the same call the city page's Schedule makes.
2. Its category is `item.category ?? item.place_category`; an activity resolving to `null` or `'other'`
   is excluded, as is one whose category is in `hidden`.
3. `byCategory[c]` is in the plan's own order — `compareItinerary` from `src/lib/ordering.ts`, borrowed
   rather than restated, so a planned row cannot sort differently from the same activity on the day plan.
4. `byPlace` maps a place id to the included activities linking to it, in the same order.
5. Pure: same inputs, same outputs; no mutation of `steps` or `items`.
6. Empty `days`, empty `items` or empty `steps` yield an `ExplorePlan` with four empty arrays and an
   empty map — never `undefined`, so callers need no null check.

**Non-goals**: it does not know about the trip's dates (the caller passes `days`), about roles or the
API (the caller passes `hidden`), or about formatting beyond `plannedLabel`.

## `plannedCounts`

Returns a count for every `Category` including `other`, which is always `0`. Total across the four
taggable categories equals the number of tagged activities the city's Schedule shows (SC-003).

## `plannedLabel`

| Input                  | Output                        |
| ---------------------- | ----------------------------- |
| `undefined` or `[]`    | `null`                        |
| one timed activity     | `Planned Thu 18 Sep, 7:00 PM` |
| one untimed activity   | `Planned Thu 18 Sep`          |
| _n_ activities (n > 1) | the first, then ` + n-1 more` |

Ordering is the caller's (`cityPlan` already sorted), so "the first" is the earliest in the plan.

## `tagZoneId`

The day plan's rule, extracted so it is testable without a render:

| `item.zone_id` | `ambiguous` | Result           |
| -------------- | ----------- | ---------------- |
| set            | either      | `item.zone_id`   |
| null           | `false`     | `fallbackZoneId` |
| null           | `true`      | `null` (no link) |

`ambiguous` is `Boolean(zoneChoices?.length)` at the call site — the screen's own existing signal that a
day is shared and the city cannot be inferred (research R6).

## Consumers

| Consumer                     | Uses                        |
| ---------------------------- | --------------------------- |
| `src/pages/Zone.tsx`         | `cityPlan`, `plannedCounts` |
| `src/pages/CategoryList.tsx` | `cityPlan`, `plannedLabel`  |
| `src/components/DayPlan.tsx` | `tagZoneId`                 |

## Analytics contract

One event, added to `AnalyticsEventProperties` in `src/lib/analytics-events.ts` **before** its call sites
(the map is what `capture` is typed against):

```ts
explore_planned_opened: {
  category: Category
  source: 'tag' | 'card'
  planned_count?: number
}
```

Three shapes. No title, no place name, no day, no city name — `sanitizeProperties` would strip a title,
but the rule is not to compose one.

`planned_count` is optional because only one of the two call sites honestly knows it. The category list
is counting the band it just drew; the day plan's pill knows the activity in front of it and not the
city's whole plan, and would have to either fetch one or invent a number. A missing property is a gap in
a chart; a made-up one is a wrong chart, so `source: 'tag'` sends it and nothing else.
