---
description: 'Task list for feature 010 — Explore, connected to the plan'
---

# Tasks: Explore, connected to the plan

**Input**: Design documents from `specs/010-explore-activity-tags/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/explore.md](./contracts/explore.md), [quickstart.md](./quickstart.md)

**Tests**: Included. The spec's whole risk is a privacy rule and a set of counting rules that a screen
cannot prove, and research R9 names the strategy: the rules are tested on data, the screens on the DOM,
and the view rule is tested twice.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: US1 (grid), US2 (category list), US3 (the tag links)

## Path Conventions

Web app, existing layout: frontend in `src/`, API in `server/`, tests in `src/tests/` (jsdom) and
`server/tests/` (node). No new directory is created by this feature.

---

## Phase 1: Setup

**Purpose**: nothing to install or scaffold — this feature adds no dependency, no directory and no
config. The one setup step is confirming the baseline is green so a later failure is unambiguously ours.

- [x] T001 Confirm the baseline: run `npm test`, `npm run typecheck` and `npm run lint` from the repo root and note the current pass state before changing anything

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the pure module every story reads, and the analytics declaration that has to exist before
any call site will compile. **No user story work can begin until this phase is complete.**

- [x] T002 [P] Declare the event `explore_planned_opened: { category: Category; source: 'tag' | 'card'; planned_count?: number }` in `src/lib/analytics-events.ts`, in a commented block beside `map_pin_opened`, noting that a title and a place name are content and are never sent. _(Done. `planned_count` ended up optional: the category list counts the band it just drew, while the day plan's pill knows one activity and not the city's plan — a missing property beats an invented one.)_
- [x] T003 Create `src/lib/explore.ts` with the types and functions in [contracts/explore.md](./contracts/explore.md) — `PlannedActivity`, `ExplorePlan`, `cityPlan`, `plannedCounts`, `plannedLabel`, `tagZoneId` — pure, importing only types from `src/api/types.ts` and `daySections` from `src/lib/schedule.ts`; no hooks, no DOM, no router
- [x] T004 In `src/lib/explore.ts`, implement `cityPlan`'s three rules: membership via `daySections(steps, day, itemsOfThatDay, zoneId)[0].items` over the given `days` (research R2), category via `item.category ?? item.place_category` with `'other'`, null and every `hidden` category dropped (FR-002, FR-006, FR-018), and ordering by `day` then `position` (FR-009); build `byPlace` in the same pass (FR-011)
- [x] T005 [P] Write `src/tests/explore.test.ts` covering, on hand-built fixtures: the typed tag beating the derived one; `'other'` and untagged activities excluded; a day two cities share counted only by the city each activity is pinned to; a null-`zone_id` activity counted on every city page whose days it falls in; a day outside `zoneDays` never counted; ordering by day then position; `hidden: ['hotel']` emptying `byCategory.hotel` and its count; `byPlace` grouping and its absence for an activity whose `place_id` was nulled; empty `steps`/`items`/`days` returning four empty arrays and an empty map
- [x] T006 [P] Extend `src/tests/explore.test.ts` (or add alongside) for the selectors: `plannedCounts` totalling per category with `other` always 0; `plannedLabel` returning null for `undefined`/`[]`, the day alone for an untimed activity, day + time for a timed one, and `+ n-1 more` for several; `tagZoneId` over its three-row table
- [x] T007 [P] Add a regression to `server/tests/visibility.test.ts`: an activity linked to a stay that the caller's view withholds comes back with `place_id`, `place_category` and `place_files` empty, **and** the traveller's own typed tag is deliberately left alone — asserted on the response body, so the client-side rule in T004 is only ever closing the one residual gap research R3 names. _(Landed beside the existing withheld-stay tests in `visibility.test.ts` rather than in `itinerary.test.ts`, which is where that claim already lives.)_

**Checkpoint**: `npx vitest run src/tests/explore.test.ts server/tests/itinerary.test.ts` is green and `npm run typecheck` passes. The rules are now proven independently of any screen.

---

## Phase 3: User Story 1 — Explore says what is planned, not just what is saved (Priority: P1) 🎯 MVP

**Goal**: the city page's Explore grid reports both numbers, shows a card for a category that is planned
but not saved, and is unchanged where nothing is planned.

**Independent test**: on a city with a plan, each card's planned number equals the tagged activities of
that category the city's Schedule shows; a planned-only category has a card; a category with neither does not.

- [x] T008 [US1] In `src/pages/Zone.tsx`, compute the city's plan in a `useMemo` from `steps`, `itinerary.data.items`, the already-computed `days` and `zoneId`, passing `hidden` derived from `useTripShows()` (`stays` off → `['hotel']`); leave it undefined while `trip`/`itinerary` are still pending so the grid paints its saved counts immediately (data-model "Loading behaviour", SC-007)
- [x] T009 [US1] In `src/pages/Zone.tsx`, change the grid's visibility rule from `place_counts[c] > 0` to "saved **or** planned" (FR-004), keeping the existing fixed category order (spec Assumptions)
- [x] T010 [US1] In `src/pages/Zone.tsx`, render the card's second line as `N saved` when nothing is planned and `N saved · M planned` when something is, reusing the existing `text-[10px] text-faint` treatment and `CATEGORY_META` — no new colour (FR-001, FR-005)
- [x] T011 [P] [US1] Write `src/tests/explore-grid.test.tsx` using `src/tests/helpers.tsx`: a card reading "4 saved · 2 planned"; a planned-only category's card present and reading "0 saved · 1 planned"; a category with neither absent; a saved-only category's card byte-for-byte as today (SC-006); and a member whose view withholds stays getting no Stays card even when an activity is typed-tagged Stays (FR-018)

**Checkpoint**: US1 ships alone. The grid is honest, and nothing below is needed for it to be worth having.

---

## Phase 4: User Story 2 — A category list shows the plan beside the saved places (Priority: P2)

**Goal**: opening a category shows what is planned above what is saved, in two labelled bands, with each
saved place that is on the plan marked with when.

**Independent test**: open a category with both, and confirm two headed bands, day and time on every
planned row, a marker on each saved place that is on the plan and none on the others.

- [x] T012 [US2] In `src/pages/CategoryList.tsx`, add `useTrip(tripId)` and `useItinerary(tripId)` and compute the city's plan with the same `cityPlan` call and the same `hidden` as `Zone.tsx` (plan.md §3; both keys are already in the query cache in the ordinary path)
- [x] T013 [US2] In `src/pages/CategoryList.tsx`, render the "On the plan" band above the saved list: one compact row per `PlannedActivity` with `fmtDayLong(day)` and `fmtTime(start_time)` (or "Anytime"), the title, and a look clearly distinct from the 96px saved cards — `sand` surface, no photo (FR-007, FR-008, FR-014)
- [x] T014 [US2] In `src/pages/CategoryList.tsx`, link each planned row: to `/trips/:tripId/places/:placeId` when it links to a place, otherwise to `/trips/:tripId/zones/:zoneId` (FR-010, research R5)
- [x] T015 [US2] In `src/pages/CategoryList.tsx`, add the "Saved" heading (shown only when the planned band is) and the `plannedLabel(byPlace.get(p.id))` chip on the rows an activity links to, leaving every other saved row exactly as it is (FR-011, FR-012)
- [x] T016 [US2] In `src/pages/CategoryList.tsx`, split the empty state: nothing at all → today's message (including the "travellers keep the stays private" branch, unchanged); planned but nothing saved → the planned band plus a "Nothing saved under … here yet" line, never a page that reads as empty (FR-013)
- [x] T017 [P] [US2] Write `src/tests/explore-list.test.tsx`: two bands in order with their headings; day and time on a planned row and "Anytime" on an untimed one; a linked planned row's href and an unlinked one's; the marker on a saved place with one activity and the `+ 1 more` form with two; no marker on a place nothing links to; the planned-but-nothing-saved state; a category with nothing planned rendering as today; and the restricted member seeing no planned stay row and no marker

**Checkpoint**: US1 + US2 — the connection reads correctly in both places a traveller looks for it.

---

## Phase 5: User Story 3 — The tag on an activity is a way in (Priority: P3)

**Goal**: tapping an activity's category pill on the day plan opens that category's list for the city the
activity is planned in.

**Independent test**: tap a tag on the day plan and land in the right city's category list; an untagged
activity offers nothing; an activity whose city cannot be told keeps a plain, unlinked pill.

- [x] T018 [US3] In `src/components/DayPlan.tsx`, resolve the tag's city with `tagZoneId(item, zoneId, Boolean(zoneChoices?.length))` and render the pill as a `Link` to `/trips/:tripId/zones/:zoneId/c/:category` when it resolves, keeping today's `span` when it does not (FR-015, FR-016, FR-017) and keeping the pill unlinked for a category in `hidden` (research R3)
- [x] T019 [US3] In `src/components/DayPlan.tsx`, fire `capture('explore_planned_opened', { category, source: 'tag', planned_count })` from the pill's `onClick` via the helper in `src/lib/posthog.ts` — never `posthog.capture` directly — and add the matching `source: 'card'` call where a planned row is opened in `src/pages/CategoryList.tsx` (FR-021)
- [x] T020 [P] [US3] Extend `src/tests/day-plan.test.tsx`: a tagged activity's pill is a link to its city's category list; an activity pinned to a city on a shared day links to _that_ city, not the other; a null-city activity on a shared trip-screen day renders an unlinked pill; an untagged activity renders no pill at all

**Checkpoint**: all three stories complete — the connection runs both ways.

---

## Phase 6: Polish & Cross-Cutting

- [x] T021 Run `npm run typecheck` — not optional in this repo, and the only thing that catches a missing or misspelled analytics property (`AnalyticsEventProperties` is what `capture` is typed against)
- [x] T022 Run `npm run lint` and `npm run format`, rather than hand-wrapping any line
- [x] T023 Run the full `npm test` and confirm both projects pass, including the untouched `src/tests/browse.test.tsx` and `src/tests/timeline.test.tsx`, which assert today's Explore grid and day plan and must either still pass or be updated deliberately
- [x] T024 [P] Update `CLAUDE.md` with a short paragraph on the connection — that `src/lib/explore.ts` owns the rules, that it composes `daySections` precisely so Explore and the Schedule on one page cannot disagree, and that `hidden` is the one client-side half of a privacy rule whose other half is the server nulling `place_id`
- [ ] T025 [P] Walk the manual table in [quickstart.md](./quickstart.md), including the restricted-member checks, and confirm the city page makes no request it did not make before (SC-007). **Not done — needs a browser and a signed-in session.** Signing in requires Supabase Auth credentials, which this environment does not have, and the restricted-member half needs a second account on a shared trip. Everything in the table is covered by an automated test (`explore-grid`, `explore-list`, `day-plan`, `explore`), and SC-007 holds by construction — no new hook was added to `Zone.tsx`, and the two `CategoryList` gained read cache keys the city page has already filled — but neither is the same as looking at it.

---

## Dependencies

```text
T001 (baseline)
  └─> Phase 2 — T002, T003 → T004 → { T005, T006, T007 }        [blocking for every story]
        ├─> Phase 3 US1 — T008 → T009 → T010, and T011 [P]
        ├─> Phase 4 US2 — T012 → T013 → T014 → T015 → T016, and T017 [P]
        └─> Phase 5 US3 — T018 → T019, and T020 [P]
              └─> Phase 6 — T021 … T025
```

- **US1, US2 and US3 are independent of each other.** Each reads `src/lib/explore.ts` and touches a
  different file, so after Phase 2 the three phases can be worked in any order or in parallel.
- Within US2 the tasks are sequential only because they edit one file.
- T019 depends on T002 (the event must be declared before a call site compiles).

## Parallel Execution Examples

**Phase 2, after T004:**

```text
T005  src/tests/explore.test.ts          (the rules)
T006  src/tests/explore.test.ts          (the selectors — same file, so sequence with T005)
T007  server/tests/itinerary.test.ts     (the payload regression) — truly parallel
```

**After Phase 2, three developers or three passes:**

```text
US1: T008 → T009 → T010   src/pages/Zone.tsx          + T011 src/tests/explore-grid.test.tsx
US2: T012 → … → T016      src/pages/CategoryList.tsx  + T017 src/tests/explore-list.test.tsx
US3: T018 → T019          src/components/DayPlan.tsx  + T020 src/tests/day-plan.test.tsx
```

## Implementation Strategy

**MVP is US1 alone.** The grid's second number is the smallest change that makes the two halves of the
city page agree, it needs no new screen and it is visible without opening anything. Ship it, then US2
(where the decision is actually made), then US3 (the cheapest, and worth least until US2's list has
something in it).

**Order within the whole**: Phase 2 first and completely. Every rule that can be got wrong — the shared
day, the legacy null-city activity, the withheld stay — lives in `src/lib/explore.ts`, and getting it
right there once is what makes the three screens above it thin enough to review by reading.
