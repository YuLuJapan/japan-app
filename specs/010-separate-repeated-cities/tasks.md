---
description: 'Task list for: Separate pages for repeated cities'
---

# Tasks: Separate pages for repeated cities

**Input**: Design documents from `/specs/010-separate-repeated-cities/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/api-delta.md](./contracts/api-delta.md), [quickstart.md](./quickstart.md)

**Tests**: Included. Not the template default — `research.md` R11 specifies them, and CLAUDE.md makes `npm test` + `npm run typecheck` the gate for every change. The split script (US-Split) in particular runs once against live data with no undo, so its rule is tested before it is run.

**Organization**: grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable — different files, no dependency on an incomplete task
- **[Story]**: which user story the task serves

## Path Conventions

Two runtimes in one repo (per plan.md): `server/src/{routes,services,lib}` for the API, `src/{pages,components,api,lib,map}` for the web app, `server/tests/*.test.ts` and `src/tests/*.test.tsx` for the two Vitest projects.

---

## Phase 1: Setup

**Purpose**: the column every later phase reads. No behaviour change — after this phase the app is byte-for-byte what it was.

- [ ] T001 Create `supabase/migrations/0023_zone_city_key.sql`: `ALTER TABLE zones ADD COLUMN city_key text` (nullable), backfill `city_key = lower(trim(name))` for existing rows, and add an index on `(trip_id, city_key)`. Confirm 0023 is still free on `main` before naming it — parallel branches otherwise claim the same number (CLAUDE.md).
- [ ] T002 [P] Add `city_key?: string | null` to `Zone` and `ZoneInput` in `server/src/lib/datastore.ts`, and add `listZoneSiblings(tripId, cityKey)` to the `DataStore` interface.
- [ ] T003 [P] Add `city_key` to `Zone` in `src/api/types.ts` (mirrors the server type; keeps the two runtimes' shapes in step).
- [ ] T004 Implement `listZoneSiblings` and carry `city_key` through create/read in `server/src/lib/datastore.memory.ts`.
- [ ] T005 Implement `listZoneSiblings` and carry `city_key` through create/read in `server/src/lib/datastore.supabase.ts`, selecting the new column everywhere `zones` is read.
- [ ] T006 Add `city_key` to every zone in `server/src/data/placeholder-data.json` (`lower(trim(name))`), so the memory backend matches what the migration leaves in Postgres.
- [ ] T007 Run `npm run typecheck && npm test` — expect green with zero behaviour change. This is the checkpoint that the column is inert.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the two pure modules that own the visit rules, plus the fixture every later test builds on. **Blocks every user story.**

- [ ] T008 [P] Create `server/src/lib/visit.ts`: given a trip's zones and steps, resolve a zone's `step_id`, dates, `ordinal` (1-based among `city_key` siblings ordered by `start_date` then `position`), `total`, and `siblings`. Pure — takes rows, returns data. Tolerates a zone with **no** step (`step_id: null`, dates null) per research.md R8.
- [ ] T009 [P] Create `src/lib/visit-label.ts`: the only place a visit's wording lives. `total === 1` → empty label (this is FR-003, structurally). Otherwise the step's dates ("19–25 Sep"), falling back to an ordinal ("2nd visit") when two siblings share dates or have none.
- [ ] T010 [P] Create `server/tests/visit.test.ts` — table-test `visit.ts` over: one visit, two visits, three visits, two visits with identical dates (ordinal fallback), a zone with no step, and a zone with a null `city_key`.
- [ ] T011 [P] Create `src/tests/visit-label.test.ts` — table-test the wording for the same cases, including the empty label for a single visit.
- [ ] T012 Extend `server/tests/fixture.ts` with a trip that visits one city twice (two steps → two sibling zones, places and tips on each) plus a city visited once as the control. Every later server test builds on this.

**Checkpoint**: the rules exist and are tested; nothing renders them yet.

---

## Phase 3: User Story 1 + User Story 2 — separate pages, and new content lands on the visit you are on (Priority: P1) 🎯 MVP

**Goal**: a repeated city opens as two independent pages, each labelled by its dates, and anything added while on one lands on that one.

**Why the two P1 stories share a phase**: spec.md says they are worthless apart — without US2 the split decays back to a pool within a day. They are also one code change: US1 is what a zone now *means*, US2 is the fact that every existing create path already files by `zone_id` and therefore needs no work beyond the zone chooser.

**Independent test**: open a trip visiting a city twice; each visit shows only its own places, tips, documents and counts; a place and a tip added from one appear only there; a city visited once is unchanged.

### The behaviour change

- [ ] T013 [US1] In `server/src/services/steps.ts`, change `resolveZoneId` so a `destination` **always** creates a zone (never finds-or-creates by name), setting `city_key` from the normalised destination name. Replace the "Find-or-create is now per trip" comment with the visit-level reasoning from research.md R1 — the comment is load-bearing documentation of a deliberate decision.
- [ ] T014 [US1] In the same file, reject a `zone_id` on `POST`/`PATCH /steps` that already belongs to another step: `400 VALIDATION`, `zone_id already belongs to another stop — add a destination to visit it again`. This closes the back door that would recreate a shared zone.
- [ ] T015 [P] [US1] Create `server/tests/steps-visits.test.ts` — adding a second stop for a city already on the trip creates a **new empty** zone (FR-006); the new zone shares `city_key` with the first; a `zone_id` that already has a step is rejected.

### The zone page learns which visit it is

- [ ] T016 [US1] In `server/src/services/zones.ts`, have `getZoneDetail` return the `visit` block (`step_id`, `start_date`, `end_date`, `ordinal`, `total`, `siblings`) using `lib/visit.ts`, per `contracts/api-delta.md` §1. No new route — the block rides on the response the page already fetches.
- [ ] T017 [P] [US1] Add the `visit` block to the zone-detail response type in `src/api/types.ts` and to its hook in `src/api/hooks.ts`.
- [ ] T018 [US1] Render the visit label on `src/pages/Zone.tsx` via `src/lib/visit-label.ts`, and render **nothing** when `visit.total === 1`.
- [ ] T019 [P] [US1] Create `src/tests/zone-visit.test.tsx` — a repeated city's page shows its dates; a single-visit city's page shows no label, no chooser, no move action (FR-003); each visit's counts equal its own lists (SC-001).
- [ ] T020 [P] [US1] Add to `server/tests/zones.test.ts`: two sibling zones return disjoint places, tips, files and counts (FR-002), and `visit.total` is 2 for each and 1 for a city visited once.

### Adding content, and the export scar

- [ ] T021 [US2] Verify and test that place, tip and file creation file against the open zone with no code change (they already take `zone_id`); add coverage to `server/tests/places.test.ts` and `server/tests/tips.test.ts` that a row created on one sibling is absent from the other (FR-008).
- [ ] T022 [US2] In `src/components/AddPlaceToDay.tsx`, offer only places belonging to the visit whose dates contain the day being edited (spec US2 scenario 3).
- [ ] T023 [US1] Delete the `counted` dedup Set and its comment from `server/src/lib/export-view.ts` — with one zone per step nothing can be counted twice (research.md R1). Keep `placesWithoutAddress` correct without it.
- [ ] T024 [P] [US1] Add to `server/tests/export.test.ts`: a repeated city renders two sections in journey order and no place appears in both (FR-018), at `share` and `full` detail.

**Checkpoint**: US1 + US2 delivered for **new** trips. The Japan trip still has one pooled Tokyo until the next phase.

---

## Phase 4: Splitting the existing trip (Priority: P1, follows Phase 3) 🚨 one-way

**Goal**: divide the Japan trip's pooled Tokyo content between its two visits, without losing anything.

**Why separate**: everything above is code and is reversible by deploying again. This phase writes to live data. It is specified (FR-012/012a/012b/012c), dry-run by default, journalled and revertible — and it is tested *before* it is run.

**Independent test**: `npm run split:visits` dry run prints exactly the table in `quickstart.md` §1; applied, all 6 places, 2 tips and 80 items remain reachable (FR-013, SC-004); run twice, the second is a no-op.

- [ ] T025 [P] [US-Split] Create `server/tests/split-visits.test.ts` **first**, over the fixture: a place scheduled inside a later visit moves there; an unscheduled place, every tip and every file stay on the first visit (FR-012b); a place scheduled inside **both** visits stays on the earliest (FR-012a — not exercised by the live data, so only this test covers it); nothing is dropped (FR-013); a second run is a no-op.
- [ ] T026 [US-Split] Create `scripts/split-visits.ts` modelled on `scripts/backfill-coords.ts`: dry-run by default, `--apply`, `--revert`, journalled to a file, and able to run against both the placeholder JSON and Supabase. Implement the rule from data-model.md §The split.
- [ ] T027 [US-Split] Add `"split:visits": "tsx scripts/split-visits.ts"` to `package.json`.
- [ ] T028 [US-Split] Run the dry run against `server/src/data/placeholder-data.json` and diff the output against the expected block in `quickstart.md` §1 before applying anything.
- [ ] T029 [US-Split] Apply to `server/src/data/placeholder-data.json` and commit the split seed, so dev and every test see what production will.
- [ ] T030 [US-Split] Update any fixture or test that assumed one Tokyo, and run `npm test && npm run typecheck`.

**Checkpoint**: the Japan trip's two Tokyos are separate locally. Production still needs the migration applied and the script run — see Phase 7.

---

## Phase 5: User Story 3 — move a place or tip to the other visit (Priority: P2)

**Goal**: correct a filing without retyping anything.

**Independent test**: move a place between visits; it leaves one list and count and joins the other with every field, link, photo and attached document intact; a place linked to a day plan warns first; a single-visit city offers no move.

- [ ] T031 [US3] Make `zone_id` writable on `PATCH` in `server/src/services/places.ts`, validated to a zone on the same trip **sharing the row's current `city_key`** (`contracts/api-delta.md` §2). Collect the errors into one array, per the service convention. Answer with the moved place through `lib/place-view.ts`, `summary_line` included.
- [ ] T032 [P] [US3] Same for `server/src/services/tips.ts` and `server/src/services/files.ts`.
- [ ] T033 [US3] Implement the FR-010 stranded-link check in `places.ts`: refuse a move that would leave itinerary items pointing at a place in another visit, returning the offending items; accept `stranded_items: 'move' | 'leave'` to resolve. Mirror the `date-impact` / `stranded_stops` idiom the app already uses.
- [ ] T034 [P] [US3] Create `server/tests/visit-move.test.ts` — a move re-parents and preserves every field; a cross-city `zone_id` is rejected; a move onto the current zone is a no-op success; the stranded refusal names the items; `'move'` brings them, `'leave'` unlinks them.
- [ ] T035 [US3] Add the move mutation to `src/api/mutations.ts`. `replaceById` does **not** apply — the row changes list — so invalidate both zones and the trip bundle, and **return** the invalidation from `onSuccess` so the toast lands with the screen (CLAUDE.md). Add `meta: { success: 'Moved to the other visit' }`.
- [ ] T036 [US3] Add "Move to another visit" to `src/pages/PlaceDetail.tsx`, rendered only when `visit.total > 1`, listing siblings by their labels, with the confirm step for stranded activities.
- [ ] T037 [P] [US3] Create `src/tests/visit-move.test.tsx` — the action is absent on a single-visit city, present on a repeated one, and the stranded confirm appears before the move completes.

**Checkpoint**: mis-filed content from Phase 4 can be corrected in-app.

---

## Phase 6: User Story 4 — every surface names the visit (Priority: P2)

**Goal**: no surface still shows two visits as one. All six read the label from `src/lib/visit-label.ts`, so none can word it differently.

**Independent test**: walk the six surfaces in `quickstart.md` §5; a repeated city appears once per visit with its dates, and a city visited once appears exactly as before.

- [ ] T038 [P] [US4] `server/src/services/search.ts` — a zone result's subtitle becomes its visit label for a repeated city; a place result names its visit (FR-016). `href` is unchanged.
- [ ] T039 [P] [US4] `src/pages/Search.tsx` — render the labelled subtitles.
- [ ] T040 [P] [US4] `src/map/scope.ts` — visit labels on the trip-scale chips (FR-017). `tripScope` already builds from steps, so this is labelling only; do not add a `scope.kind` branch (spec 004's rule).
- [ ] T041 [P] [US4] `src/components/Breadcrumbs.tsx` — name the visit and return to it (FR-019).
- [ ] T042 [P] [US4] `src/components/Schedule.tsx`, `src/components/DayPlan.tsx`, `src/components/DayHighlights.tsx` — a day's activities link to the visit whose dates contain that day (FR-015).
- [ ] T043 [P] [US4] `src/components/JourneyStepsSlider.tsx` and `src/pages/JourneySteps.tsx` — show the visit label on a repeated city's cards.
- [ ] T044 [US4] Section headings in `server/src/lib/export-view.ts` take the label; classify `city_key` as `'never'` in `ZONE_FIELD_POLICY` (it is plumbing, not trip content) so `npm run typecheck` passes.
- [ ] T045 [P] [US4] Add per-visit assertions to `server/tests/map-pins.test.ts` and `server/tests/search.test.ts`.

---

## Phase 7: Polish, safety and deploy

- [ ] T046 [US-Del] Warn before deleting a stop that still holds content, naming the counts and offering to move it to a sibling, in `src/pages/JourneySteps.tsx`. The step's zone and content are **not** cascaded (FR-011, research.md R8).
- [ ] T047 [P] [US-Del] `server/tests/steps.test.ts` — deleting a step leaves its zone and every place, tip and file intact and still findable (no silent file loss).
- [ ] T048 [P] Add the SC-007 test: for a member whose view hides stays, **both** visits omit stays and stay counts, and no per-visit count can be differenced against another to infer a hidden booking (FR-020).
- [ ] T049 [P] Handle the orphan zone (no step) on `src/pages/Zone.tsx` — a visit removed from the journey still opens, with no dates and no ordinal.
- [ ] T050 Fold `contracts/api-delta.md` into `specs/001-japan-trip-app/contracts/api.md` — it is the source of truth and is referenced from code comments, not historical documentation.
- [ ] T051 Update `CLAUDE.md`: a zone is a **visit**, not a city; `city_key` links siblings; the export's dedup workaround is gone and why. Future readers will otherwise re-derive the old meaning from the name "zone".
- [ ] T052 Run the full gate — `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- [ ] T053 Walk `quickstart.md` §2–§7 by hand against `npm run dev`, including the single-visit control (SC-005).
- [ ] T054 🚨 **Deploy in order** (`quickstart.md` §Deploying): apply `0023_zone_city_key.sql` to the live Supabase project by hand, **then** `npm run split:visits` against Supabase (dry run first, keep the journal), **then** deploy the app. Reversed, the deployed app 500s on its first zone read while every test still passes, because tests use the memory store.

---

## Dependencies

```
Phase 1 Setup (T001–T007)
    ↓
Phase 2 Foundational (T008–T012)   ← blocks everything
    ↓
Phase 3 US1 + US2 (T013–T024)      ← MVP for new trips
    ↓
Phase 4 Split (T025–T030)          ← MVP for the Japan trip; needs Phase 3's model
    ↓
Phase 5 US3 (T031–T037)            ┐ independent of each other
Phase 6 US4 (T038–T045)            ┘ both need Phase 2's label + Phase 3's model
    ↓
Phase 7 Polish (T046–T054)
```

- **US1 and US2** ship together (Phase 3) — spec.md says they are worthless apart.
- **The split (Phase 4)** must follow Phase 3: it creates sibling zones, which only mean something once a zone is a visit.
- **US3 and US4** are independent of each other and can be worked in parallel by two people.
- **T054 is last, always** — the ordering is the known failure mode from CLAUDE.md.

## Parallel opportunities

| Where | Tasks |
| --- | --- |
| Phase 1 | T002, T003 together; then T004, T005, T006 |
| Phase 2 | T008–T011 all four at once (two source files, two test files) |
| Phase 3 | T015, T017, T019, T020, T024 alongside their implementation tasks |
| Phase 5 | T032, T034, T037 |
| Phase 6 | T038–T043 and T045 — seven files, one shared helper, no ordering between them |
| Phase 7 | T047, T048, T049 |

## Implementation strategy

**MVP = Phase 1 → 2 → 3 → 4.** That is the traveller's actual request: the Japan trip's two Tokyos, separate. 30 of 54 tasks.

Stop after Phase 4 and the feature is real but manual to correct — a mis-filed place has to be deleted and retyped. Phase 5 (the move) is what makes the filing fixable, and given Phase 4 files by a heuristic, it should follow quickly. Phase 6 is polish that prevents the confusion reappearing in search and the export.

**Do not reorder Phase 4 before Phase 3**, and do not fold T054 into an earlier phase.

## Test coverage by requirement

| Requirement | Covered by |
| --- | --- |
| FR-001/002 (separation) | T019, T020, T024 |
| FR-003 (single-visit unchanged) | T019, T053 (SC-005) |
| FR-005 (labels, ordinal fallback) | T010, T011 |
| FR-006 (new stop, new visit) | T015 |
| FR-007/007a (one visit per row) | T031, T034 |
| FR-008 (new content files locally) | T021 |
| FR-009/010 (move, stranded links) | T034, T037 |
| FR-011 (deleting a visit) | T047 |
| FR-012/012a/012b/012c (the split) | T025, T028 |
| FR-013 (nothing lost) | T025 |
| FR-014/014a (identity, siblings) | T010, T015 |
| FR-015–019 (other surfaces) | T045, T053 |
| FR-020 / SC-007 (visibility) | T048 |
