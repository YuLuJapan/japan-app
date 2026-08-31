# Implementation Plan: Explore, connected to the plan

**Branch**: `claude/explore-tags-connection-zmqxuz` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-explore-activity-tags/spec.md`

## Summary

The city page already loads everything this feature needs and throws half of it away. `useZone(zoneId)`
brings the saved counts; `useTrip(tripId)` brings the journey steps; `useItinerary(tripId)` brings every
activity on the trip, each carrying `zone_id`, `day`, `start_time`, `position`, its typed `category` and
the derived `place_category` — and the city page already calls all three, because the Schedule section
under the hero is drawn from exactly that. Explore sits ten lines further down the same component and
reads none of it.

So this is **one pure module plus three render sites**, with no server change at all:

- `src/lib/explore.ts` — new, pure. Given the trip's steps, the trip's activities, the city's days and
  the city's saved counts, it answers "what is planned here, per category" and "which saved places are
  on the plan". Every rule in the spec that could be got wrong lives in this one file and is unit-tested
  on data, not on a screen.
- `src/pages/Zone.tsx` — the Explore grid reads the planned counts alongside `place_counts`, and its
  `visible` filter becomes "saved **or** planned".
- `src/pages/CategoryList.tsx` — a "On the plan" band above the existing saved list, and a
  "planned" marker on the saved rows that activities link to.
- `src/components/DayPlan.tsx` — the category pill becomes a `Link` when the activity's city is known.

The one thing the client cannot do for itself is the view rules — and it does not have to. The server
already withholds stays from `place_counts` (`hideStayCounts`) and already nulls `place_id`,
`place_category` and `place_files` on any activity pointing at a withheld stay (`listItinerary`). A
withheld stay therefore arrives with **no category at all**, so a planned count built from
`item.category ?? item.place_category` cannot resurrect it. The remaining hole is the traveller's own
typed `category: 'hotel'` on such an activity, which the server does not clear — handled by
`hiddenCategories` in the new module (research R3), driven by `useTripShows()`, which the page already has.

## Technical Context

**Language/Version**: TypeScript 5.x, React 18, strict mode

**Primary Dependencies**: React Router (`createBrowserRouter`), TanStack Query, Tailwind. No new dependency.

**Storage**: none touched. No migration, no new column, no new endpoint (FR-019, FR-020).

**Testing**: Vitest, two projects. `src/tests/*.test.tsx` (jsdom + React Testing Library, helpers in
`src/tests/helpers.tsx`) and `src/tests/*.test.ts` for the pure module. `server/tests/` gains one
regression test only — the guarantee that a withheld stay's activity arrives with no category.

**Target Platform**: mobile web / installed PWA; the city page is the second-most-opened screen.

**Project Type**: web app — Vite frontend + Express API sharing one repo.

**Performance Goals**: no additional network request on a city page (SC-007). The new work is a single
pass over the trip's activities (tens of rows) done in `useMemo`, on data already in the query cache.

**Constraints**: the four flags on the trip view must not widen (FR-018); analytics carries shapes only
(FR-021); the export is untouched (FR-022); Explore and Schedule must agree on the same page (FR-003).

**Scale/Scope**: 3 changed components, 1 new pure module, 1 new analytics event, ~6 test files.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

`.specify/memory/constitution.md` is the unfilled Spec Kit template — no ratified principles to check
against. The project's real standing rules live in `CLAUDE.md`, and this plan is gated on those instead:

| Rule (CLAUDE.md)                                                              | Status  | How                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Anything returning a place, place id, file or booking metadata needs the view | ✅ PASS | Nothing new is returned. The two payloads used are already view-filtered server-side; the one residual leak is closed client-side (R3). |
| A new route inherits the access check, not the view                           | ✅ PASS | No new route.                                                                                                                           |
| Adding a column to `Place` is a compile error until classified                | ✅ PASS | No column added, so neither field policy moves.                                                                                         |
| Analytics: a property is a shape, never trip content                          | ✅ PASS | One new event, three properties: `category`, `kind` (`'planned' \| 'saved'`), `planned_count`. Declared in `analytics-events.ts` first. |
| Never call `posthog.capture` directly                                         | ✅ PASS | Goes through `capture` from `src/lib/posthog.ts`.                                                                                       |
| Pure logic out of components (`pins.ts`/`scope.ts` precedent)                 | ✅ PASS | `src/lib/explore.ts` takes data and returns data; the pages orchestrate and do no arithmetic.                                           |
| Reuse the design tokens; a category's colour lives in `CATEGORY_META`         | ✅ PASS | Planned rows use the same `CATEGORY_META` pill and the existing `sand`/`faint`/`brand` ramp. No fifth palette.                          |
| `npm run typecheck` is part of the test path                                  | ✅ PASS | In the task list, not optional.                                                                                                         |
| Free-tier budget                                                              | ✅ PASS | Client-side reading of data already fetched. No new infrastructure.                                                                     |

**Post-Phase-1 re-check**: unchanged — the design added no endpoint, no stored field and no new
palette, and moved the one privacy decision into a named, tested function rather than a page.

## Project Structure

### Documentation (this feature)

```text
specs/010-explore-activity-tags/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── explore.md       # The pure module's contract (this feature adds no HTTP contract)
├── checklists/
│   └── requirements.md  # Written by /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── explore.ts             # NEW — the whole feature's logic, pure
│   └── schedule.ts            # unchanged; `daySections`/`zoneDays` are reused as-is
├── pages/
│   ├── Zone.tsx               # Explore grid: planned counts, "saved or planned" visibility
│   └── CategoryList.tsx       # planned band + planned marker on saved rows
├── components/
│   └── DayPlan.tsx            # the category pill becomes a link when the city is known
├── lib/
│   └── analytics-events.ts    # + explore_planned_opened
└── tests/
    ├── explore.test.ts        # NEW — the pure rules (counting, view, ordering, shared days)
    ├── explore-grid.test.tsx  # NEW — Zone's grid
    ├── explore-list.test.tsx  # NEW — CategoryList's two bands
    └── day-plan.test.tsx      # + the tag-links-to-Explore cases

server/
└── tests/
    └── itinerary.test.ts      # + regression: a withheld stay's activity carries no category
```

**Structure Decision**: the existing frontend layout is kept exactly. The new module goes in `src/lib/`
beside `schedule.ts`, whose helpers it composes — not in a feature folder like `src/map/`, because that
boundary exists to fence off a library (Leaflet) and there is no library here.

## Approach

### 1. `src/lib/explore.ts` — one pass, four answers

```ts
export interface PlannedActivity {
  id: string
  title: string
  day: string
  start_time: string | null
  category: Category // resolved: item.category ?? item.place_category
  place_id: string | null
  zone_id: string | null
}

export interface ExplorePlan {
  /** Planned activities in this city, by category, in plan order. */
  byCategory: Record<Category, PlannedActivity[]>
  /** Per saved place: the activities in this city that link to it, in plan order. */
  byPlace: Map<string, PlannedActivity[]>
}

export function cityPlan(
  steps: TripStep[],
  items: ItineraryItem[],
  days: string[], // zoneDays(...) — the city's own days
  zoneId: string,
  hidden: Category[] // categories this member may not see (stays, today)
): ExplorePlan
```

Three rules and nothing else:

- **Which activities are this city's** — for each day in `days`, `daySections(steps, day, itemsOfDay, zoneId)[0].items`.
  Literally the call the Schedule on that page makes, which is what makes FR-003 true by construction
  rather than by care.
- **Which category** — `item.category ?? item.place_category`, the same precedence `DayPlan` already
  applies, then dropped if the category is in `hidden` or is `'other'` (FR-002, FR-006, FR-018).
- **Order** — by `day`, then `position`; the store's own order within a day (FR-009).

`byPlace` falls out of the same pass and is what marks a saved row (FR-011).

Two thin selectors on top, so neither page does arithmetic:

- `plannedCounts(plan)` → `Record<Category, number>` for the grid.
- `plannedLabel(activities)` → `'Planned Thu 19:00'` / `'Planned Thu 19:00 + 1 more'`, the saved row's marker.

### 2. `Zone.tsx` — the grid

`visible` becomes `CATEGORIES.filter((c) => place_counts[c] > 0 || planned[c] > 0)` (FR-004), and the
card's second line becomes `4 saved` or `4 saved · 2 planned` (FR-001, FR-005). The plan half is computed
in a `useMemo` and is simply absent while `trip`/`itinerary` are still loading, so the grid paints its
saved counts immediately and gains the planned half when the plan lands (spec edge case, SC-007).

### 3. `CategoryList.tsx` — two bands

The page already has `useZone`; it gains `useTrip` + `useItinerary` (both already cached by the city page
one tap earlier, so this is a cache read in practice, not a fetch). Then:

- **"On the plan"** — the category's `PlannedActivity[]`, each row: day, time (`fmtTime`, or "Anytime"),
  title. Linked rows go to `/trips/:tripId/places/:placeId`; unlinked rows go to the city page, which is
  where that day's plan is read (FR-010). Rows are visually distinct from the saved cards — a compact
  timeline-ish row on `sand`, not the 96px photo card (FR-014).
- **"Saved"** — today's list, plus `plannedLabel(byPlace.get(p.id))` as a chip when the place is on the
  plan (FR-011, FR-012). The heading only appears when the planned band does; a category with nothing
  planned renders exactly as today (SC-006).
- The empty state splits: nothing at all → today's message; planned but nothing saved → the planned band
  plus "Nothing saved under food here yet" (FR-013).

### 4. `DayPlan.tsx` — the pill

`tag` already resolves. The city is `item.zone_id ?? (zoneChoices ? null : zoneId)` — `zoneChoices` being
present is exactly the screen's own admission that it cannot tell (Schedule sets it only on a shared day
on the trip screen), so it is the honest signal for FR-016 rather than a new guess. With a city, the pill
renders as a `Link` to `/trips/:tripId/zones/:zoneId/c/:category` and fires `explore_planned_opened`;
without one it stays the `span` it is today (FR-016, FR-017).

## Complexity Tracking

No constitution violations to justify. One judgement call worth recording: `CategoryList` gains two query
hooks it did not have, which is a _third_ consumer of the trip bundle. Rejected alternative: passing the
plan down through the route, which would have made the page unopenable directly from a bookmark and is
the kind of coupling `useTrip` exists to avoid. Both hooks read the same cache keys the city page filled,
so the cost is a cache hit, not a request.
