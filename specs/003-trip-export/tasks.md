# Tasks: Export the Trip

**Input**: Design documents from `specs/003-trip-export/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/export-api.md](./contracts/export-api.md),
[quickstart.md](./quickstart.md)

**Tests**: Included. Not a default — the spec asks for them directly (FR-011 _is_ a test), and the repository
runs 169 of them across two Vitest projects. Server tests use supertest against `createApp()` with the
fixture store; web tests use React Testing Library.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: which user story the task serves (US1–US4); Setup, Foundational and Polish carry none

## Path Conventions

Web app, existing layout: `server/src/` (Express) and `src/` (React) in one repository. Server tests live in
`server/tests/*.test.ts`, web tests in `src/tests/*.test.tsx`.

---

## Phase 1: Setup

**Purpose**: The two things that must exist before any code in this feature is written.

- [x] T001 Add `"typecheck": "tsc --noEmit"` to the `scripts` block of `package.json`, run it, and fix or record anything it reports on `main` today — this feature's central guard is a type error, and nothing in the test path currently checks types (research R6)
- [x] T002 [P] Add `jspdf` and `jspdf-autotable` to `dependencies` in `package.json` (research R2 — pinned, and imported only from `src/export/`, never from the entry bundle)

**Checkpoint**: `npm run typecheck` passes and the PDF libraries are installed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The projection, its data, and the route that serves it. Every story reads through this.

**⚠️ CRITICAL**: No user story can begin until this phase is complete.

- [x] T003 Add `listAllPlaces(tripId)` and `listAllTips(tripId)` to the `DataStore` interface in `server/src/lib/datastore.ts`, with doc comments naming the export as the caller (research R5)
- [x] T004 [P] Implement both methods in `server/src/lib/datastore.memory.ts`, returning rows in the same order the per-parent reads already return them
- [x] T005 [P] Implement both methods in `server/src/lib/datastore.supabase.ts` as one query each, ordered to match
- [x] T006 Extend `server/tests/ordering.test.ts` so the new sweeps and the existing `listPlacesInZone` / `listTips` reads are asserted over the same rows — the precedent for stopping two implementations drifting apart
- [x] T007 Create `server/src/lib/export-view.ts`: the `ExportLevel` type and the field-policy maps for `Place`, `Zone`, `Trip`, `JourneyStep`, `Tip` and `ItineraryItem`, each typed `Record<keyof Entity, ExportLevel>` per [data-model.md](./data-model.md) §1 — this is the file the whole feature is about
- [x] T008 Implement the pure projection in `server/src/lib/export-view.ts`: signature takes `TripView` first, applies the view before the field policy ([data-model.md](./data-model.md) §4), and emits the share level. The full branch is US2 — leave it a documented gap, not a silent one
- [x] T009 [P] Extend `server/tests/fixture.ts` with a place carrying **every** field populated, a `hotel` place, zone-level and place-level tips, and a couple of itinerary rows — the fixture that makes the exclusion tests meaningful
- [x] T010 Table tests in `server/tests/export-view.test.ts`: the share projection of the fully-populated place emits exactly `name`, `address`, `category`; the view is applied before the policy; a hidden stay and its tips are gone. Include the runtime key-set assertion from research R6
- [x] T011 Create `server/src/services/export.ts`: validate `detail` (collect into a `details` array per the house pattern), gather rows through the store in five queries, apply the view, call the projection, compute `stats`
- [x] T012 Create `server/src/routes/export.ts` — `GET /export`, `asyncHandler`-wrapped, resolving the store via `getDataStore()` — and mount `exportTripRouter` inside `tripScopedRouter()` in `server/src/app.ts`
- [x] T013 Supertest coverage in `server/tests/export.test.ts`: 200 at share detail, 400 on a missing or bad `detail`, 404 for a trip the caller is not a member of, and a viewer without `can_see_stays` receiving no hotel and `included_stays: false`
- [x] T014 [P] Add the export payload types to `src/api/types.ts` and a `useTripExport(detail)` hook to `src/api/hooks.ts`, keyed `['export', tripId, detail]` with a 5-minute `staleTime`
- [x] T015 Merge the endpoint into `specs/001-japan-trip-app/contracts/api.md` (the API's source of truth) — the route, the query parameter, the two response shapes, the 404-not-403 rule and the FR-004a exclusions

**Checkpoint**: the endpoint answers at share detail, is access-checked by construction, and the projection is
under test. User stories can begin.

---

## Phase 3: User Story 1 — Share my trip with a friend (Priority: P1) 🎯 MVP

**Goal**: A traveller taps "Share with a friend" and hands someone a PDF containing the journey, the zones,
the dates and each place's name, address and category — and nothing they typed.

**Independent Test**: Export a trip as a share PDF and confirm it contains journey steps, zones, dates and
each place's name, address and category, and no description, links, tips or day plan.

### Tests for User Story 1

- [x] T016 [P] [US1] In `server/tests/export.test.ts`, assert a share payload of a trip whose hotel descriptions contain "booking", "confirmation" and "reservation" contains none of those strings anywhere in the serialised response
- [x] T017 [P] [US1] Web test in `src/tests/export-page.test.tsx`: the export screen renders two separately labelled actions and no control that switches one into the other (FR-005)
- [x] T018 [P] [US1] Web test in `src/tests/export-file.test.ts`: filename rules, and that delivery falls back to a download when `navigator.canShare` is absent or rejects files

### Implementation for User Story 1

- [x] T019 [P] [US1] Declare `trip_exported` in `src/lib/analytics-events.ts` — `{ format, detail, place_count, day_count, included_stays }` — before any call site exists, or `capture` will not compile (research R8)
- [x] T020 [P] [US1] Create `src/lib/export-file.ts`: build the filename from the trip title and detail level following the sanitising rules in `downloadName` (`server/src/services/files.ts`), and deliver via `navigator.share({ files })` behind a `canShare` guard with an object-URL download fallback, as `src/pages/DocumentPreview.tsx` already does
- [x] T021 [US1] Create `src/export/pdf.ts`, dynamically imported: render the share payload — cover, contents page keyed to journey steps, one section per step, places as rows — with the two-pass layout that records each step's page and stamps `Page n of m` (research R2)
- [x] T022 [US1] Render the count of places with no address in the PDF, and list such places by name rather than as blank rows (FR-018, spec edge case)
- [x] T023 [US1] Create `src/pages/TripExport.tsx`: both labelled actions, a generating state, and a result sheet offering Share and Save (research R7 — the second tap is what keeps iOS Safari's Web Share working)
- [x] T024 [US1] Add `{ path: 'export', element: <TripExport /> }` under the trip route in `src/router.tsx`, and an entry point to it from the trip home so the feature is reachable
- [x] T025 [US1] Fire `trip_exported` on a completed export, and report a failed one through `captureError`; show an error toast via `src/lib/toast.ts` when generation or the payload fetch fails, so a failure speaks rather than leaving a stalled spinner (FR-020)
- [x] T026 [US1] Add the low-priority background prefetch of both detail levels on trip-home mount, guarded on `navigator.onLine` and deferred past first paint (research R4) — this is the whole of the offline guarantee (SC-004)

**Checkpoint**: US1 ships on its own. A share PDF, produced on the device, working with no signal.

---

## Phase 4: User Story 2 — Keep a full copy of my own trip (Priority: P2)

**Goal**: The same two actions, with "Full copy" producing descriptions, links, tips and the day-by-day plan.

**Independent Test**: Export the full version and confirm descriptions, links, tips and the day plan are
present, and that a viewer's export still respects their view.

### Tests for User Story 2

- [x] T027 [P] [US2] In `server/tests/export.test.ts`: an **owner** with the unrestricted view exporting at full detail receives no flight, no shopping item, no document and no member name (FR-004a) — the case most likely to be assumed safe
- [x] T028 [P] [US2] In `server/tests/export-view.test.ts`: full-level table tests, including a tip whose parent is a hidden stay and an itinerary row pointing at one

### Implementation for User Story 2

- [x] T029 [US2] Implement the full branch of the projection in `server/src/lib/export-view.ts` — descriptions, links, zone summaries, tips nested under their parents
- [x] T030 [US2] Gather the itinerary in `server/src/services/export.ts` and build `days`, nulling `place_name` where the place is hidden, the way the itinerary service already treats `place_id`
- [x] T031 [US2] Add the full-detail sections to `src/export/pdf.ts`: descriptions, links, tips, and a day-by-day section ordered by day then position
- [x] T032 [US2] Wire "Full copy" in `src/pages/TripExport.tsx` to `detail=full`, leaving both actions exactly as labelled

**Checkpoint**: both versions work, and both stay inside FR-004a.

---

## Phase 5: User Story 3 — Choose the file format (Priority: P3)

**Goal**: The same content as a word-processor or spreadsheet file.

**Independent Test**: Export the same trip as DOCX and XLSX and confirm identical content to the PDF.

### Tests for User Story 3

- [x] T033 [P] [US3] Web tests in `src/tests/export-file.test.ts` asserting each writer produces the same content at the same detail level — the payload is the fixture, so the writers can be compared to each other

### Implementation for User Story 3

- [x] T034 [US3] Choose the DOCX and XLSX libraries and record the decision in `specs/003-trip-export/research.md` R3, weighing precache weight and the reading requirement spec 007 depends on
- [x] T035 [P] [US3] Create `src/export/docx.ts`, dynamically imported, over the unchanged payload
- [x] T036 [P] [US3] Create `src/export/xlsx.ts`, dynamically imported — places as sortable rows, one sheet per detail level's structure
- [x] T037 [US3] Add the format choice to the result sheet in `src/pages/TripExport.tsx`, and pass `format` to `trip_exported`. The format must not change what is included (FR-014)

**Checkpoint**: three readable formats, one payload.

---

## Phase 6: User Story 4 — Keep a machine-readable backup (Priority: P3)

**Goal**: A structured file of the whole trip, identifiers intact, so a copy survives losing the project.

**Independent Test**: Download the JSON and confirm every field and id round-trips.

### Tests for User Story 4

- [x] T038 [P] [US4] Web test in `src/tests/export-file.test.ts`: the JSON writer emits `id` and `zone_id`, and it is the **only** writer that does; at share detail it still carries exactly the share fields

### Implementation for User Story 4

- [x] T039 [US4] Add the `json` column to the field policy in `server/src/lib/export-view.ts` for `id` and `zone_id` only ([data-model.md](./data-model.md) §1), and emit them from the projection when asked
- [x] T040 [US4] Create `src/export/json.ts` and add it to the format choice — the cheapest writer of the four, and the one that can be pulled forward if a backup is wanted before DOCX and XLSX

**Checkpoint**: all four stories independently functional.

---

## Phase 7: Polish & Cross-Cutting

- [x] T041 Build a ~120-place fixture trip (3× the real one) in `server/tests/fixture.ts` and run the pagination, contents-page and page-number checks from [quickstart.md](./quickstart.md) — the seed data has 39 places and cannot exercise SC-003
- [x] T042 [P] Confirm `npm run build` leaves the entry chunk at ~157 KB gzip and that the PDF writer is a separate lazy chunk present in the Workbox precache manifest — the precache entry is what makes offline export work, so its absence is a bug, not an optimisation
- [x] T043 [P] Verify the drift guard bites: add a field to `Place`, confirm `npm run typecheck` fails, remove it
- [x] T044 Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run format` from the repository root, and walk [quickstart.md](./quickstart.md) end to end, offline check included
- [x] T045 Update `CLAUDE.md` with a short paragraph on the export: where the projection lives, why the view is applied before the field policy, and why the rendering must stay on the device

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** — no dependencies. T001 blocks T007/T010 in spirit as well as in fact: without the typecheck script the field policy is decoration.
- **Foundational (Phase 2)** — depends on Setup. **Blocks every story.**
- **US1 (Phase 3)** — depends on Foundational only.
- **US2 (Phase 4)** — depends on Foundational. Independently testable, but only meaningful once US1's screen and PDF writer exist, which is what the spec says about it.
- **US3 (Phase 5)** and **US4 (Phase 6)** — depend on Foundational plus a working writer path from US1. Independent of each other.
- **Polish (Phase 7)** — after the stories you intend to ship.

### Within Foundational

T003 → (T004, T005 in parallel) → T006. T007 → T008 → T010. T011 depends on T008 and on the new store
reads; T012 depends on T011; T013 depends on T012. T009 and T014 are parallel to all of it.

### Within US1

T019, T020 and the three tests are parallel. T021 depends on T020 (delivery) only for wiring; T022 depends on
T021. T023 depends on T020 and T021. T024 depends on T023. T025 depends on T019 and T023. T026 is
independent of the rest of the story and can go first or last.

### Parallel opportunities

- Setup: T002 alongside T001.
- Foundational: T004 ∥ T005; T009 ∥ T014 ∥ the T003–T006 chain.
- US1: T016 ∥ T017 ∥ T018 (tests), then T019 ∥ T020.
- US2: T027 ∥ T028.
- US3: T035 ∥ T036 once T034 is decided.
- Polish: T042 ∥ T043.

---

## Parallel Example: Foundational

```bash
# The two backends implement the same two reads, in different files:
Task: "Implement listAllPlaces/listAllTips in server/src/lib/datastore.memory.ts"
Task: "Implement listAllPlaces/listAllTips in server/src/lib/datastore.supabase.ts"

# Independent of the store work entirely:
Task: "Extend server/tests/fixture.ts with a fully-populated place, a hotel, tips and itinerary rows"
Task: "Add export payload types to src/api/types.ts and useTripExport to src/api/hooks.ts"
```

## Parallel Example: User Story 1

```bash
# All three tests first, they should fail:
Task: "Assert a share payload contains no booking/confirmation/reservation strings, server/tests/export.test.ts"
Task: "Assert two labelled actions and no toggle, src/tests/export-page.test.tsx"
Task: "Assert filename rules and the download fallback, src/tests/export-file.test.ts"

# Then the two independent modules:
Task: "Declare trip_exported in src/lib/analytics-events.ts"
Task: "Create src/lib/export-file.ts — filename rules and share-or-download delivery"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 Setup — T001 first, always. The typecheck script is what makes T007 real.
2. Phase 2 Foundational — the projection, the store reads, the endpoint.
3. Phase 3 US1 — share PDF, delivery, the screen, the prefetch.
4. **Stop and validate**: run the US1 section of [quickstart.md](./quickstart.md), including the offline check
   and the grep for booking strings.
5. Shippable: this is the smallest complete version of the feature and the reason it went first.

### Incremental delivery

Foundational → US1 (ship) → US2 (ship) → US3 / US4 in either order. US4 is the cheapest of the four and needs
no new dependency, so pull it forward if a backup is wanted before the Office formats.

### Notes

- Both export actions exist on the screen from T023, in phase 3, even though "Full copy" is not wired until
  T032. FR-005 is about the shape of the UI: adding the second button later is exactly how a feature ends up
  with a toggle.
- The one task that cannot be skipped without silently voiding a requirement is **T001**. Everything else
  fails loudly.
