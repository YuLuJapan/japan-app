# Phase 1 — Data model: Explore, connected to the plan

**Nothing is stored by this feature.** No table, no column, no migration, no change to any request or
response body. Everything below is a _derived view_ computed on the device from two payloads it already
holds. That is the whole design: the export's field policy (`server/src/lib/export-view.ts`) is keyed on
`keyof ItineraryItem` and `keyof Place`, so a stored field here would have had to be classified and
rendered by four writers; a derived one keeps the export projecting rows it already knows (FR-022).

## Existing entities this reads (unchanged)

| Entity          | Source                                | Fields used                                                                                         |
| --------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `TripStep`      | `GET /trips/:id` → `steps`            | `position`, `start_date`, `end_date`, `zone.id`, `zone.name`                                        |
| `ItineraryItem` | `GET /trips/:id/itinerary` → `items`  | `id`, `title`, `day`, `start_time`, `position`, `zone_id`, `place_id`, `category`, `place_category` |
| `ZoneDetail`    | `GET /trips/:id/zones/:zoneId`        | `place_counts`                                                                                      |
| `PlaceListItem` | `GET /trips/:id/zones/:zoneId/places` | `id`, `name`, `summary_line`, `image_url`                                                           |
| `TripView`      | trip bundle → `shows`                 | `stays` (drives `hidden`)                                                                           |

Note what is **already** true of the itinerary payload for a member who may not see stays: `place_id` is
nulled on any activity linked to a stay, and `place_category`/`place_files` are derived from `place_id`,
so they arrive null and empty. The client adds one rule on top (`hidden`), and no more.

## Derived entities (new, client-side only)

### `PlannedActivity`

One activity of the city's plan, reduced to what Explore renders. It is a projection of `ItineraryItem`,
not a new kind of thing.

| Field        | Type             | Rule                                                                  |
| ------------ | ---------------- | --------------------------------------------------------------------- |
| `id`         | `string`         | the activity's id — the React key, and nothing else                   |
| `title`      | `string`         | shown on the planned row; never sent to analytics                     |
| `day`        | `string` (ISO)   | shown as "Thu 18 Sep"                                                 |
| `start_time` | `string \| null` | shown via `fmtTime`; null renders as "Anytime", as the day plan does  |
| `position`   | `number`         | never rendered — carried so `compareItinerary` can order these rows   |
| `category`   | `Category`       | **resolved**: `item.category ?? item.place_category`; never `'other'` |
| `place_id`   | `string \| null` | where the row links; null after the server cut a withheld stay's link |
| `zone_id`    | `string \| null` | carried through for the tag link; null on a legacy activity           |

**Invariants**

1. `category` is one of `hotel | attraction | food | shopping` — `'other'` is never a tag (FR-006), and an
   activity resolving to no category is not a `PlannedActivity` at all.
2. `category` is never one of `hidden` (FR-018).
3. A `PlannedActivity` exists only for an activity the city's own Schedule shows (FR-003).

### `ExplorePlan`

The single value one pass over the trip's activities produces for one city.

| Field        | Type                                  | Meaning                                                         |
| ------------ | ------------------------------------- | --------------------------------------------------------------- |
| `byCategory` | `Record<Category, PlannedActivity[]>` | the planned band per category, in plan order                    |
| `byPlace`    | `Map<string, PlannedActivity[]>`      | per saved place id, the activities in this city that link to it |

**Invariants**

1. Every array in `byCategory` is sorted by `day`, then `position` (FR-009).
2. `byCategory.other` is always empty.
3. `byCategory[c]` is empty for every `c` in `hidden`.
4. `byPlace` has an entry only for a place some counted activity links to — so a place whose link the
   server cut is absent, and cannot be marked (FR-018).
5. `sum(byCategory[c].length)` over the four taggable categories equals the number of tagged activities
   the city's Schedule shows, which is what SC-003 is measured on.

### Selectors

| Selector                   | Returns                    | Used by                                                        |
| -------------------------- | -------------------------- | -------------------------------------------------------------- |
| `plannedCounts(plan)`      | `Record<Category, number>` | the grid's second number and its "saved or planned" visibility |
| `plannedLabel(activities)` | `string \| null`           | the marker on a saved row: `Planned Thu 19:00`, `+ 1 more`     |

`plannedLabel` returns `null` for an empty or missing array, so a saved place nothing links to is
untouched (FR-012) without the caller writing a conditional.

## State transitions

None. There is no state — `ExplorePlan` is recomputed from the two cached payloads whenever either
changes, in a `useMemo`. An activity edited on the trip screen invalidates `['itinerary', tripId]`, the
city page re-renders, and the counts follow. Nothing to migrate, nothing to keep in sync, nothing that
can go stale independently of the data it is derived from.

## Loading behaviour

`useZone` resolves independently of `useTrip`/`useItinerary`. Until the latter two land, `cityPlan` is not
called and the grid shows its saved counts alone — the same grid the app draws today. It never renders a
provisional planned number that later changes (spec edge case: "The plan has not arrived yet").
