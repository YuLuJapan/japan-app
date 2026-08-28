---
description: 'Task list for the Map feature'
---

# Tasks: Map

**Input**: Design documents from `/specs/004-trip-map/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/map.md](./contracts/map.md), [quickstart.md](./quickstart.md)

**Tests**: Included. This repository ships 940 tests and treats them as the contract (`CLAUDE.md`), and the plan names the test files each slice needs. Tests are listed **before** the code they cover wherever that is honest. Two are not: T022 (the stay filter, on an endpoint that already filters) and T044 (watching the field-policy guard actually fail) lock in behaviour rather than drive it, so they pass the moment they are written — that is the point of them, and pretending otherwise would be theatre.

**Organization**: by user story, in the priority order the spec sets. The four delivery slices in `plan.md` map onto the phases as: Slice A = Phase 2, Slice B = Phase 3, Slice C = Phases 4–5, Slice D = Phases 6–7.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: the user story the task serves (US1–US5). Setup, Foundational and Polish carry no story label.
- Every task names the exact file it touches.

## Path Conventions

Web application, existing layout (`plan.md` → Project Structure): React SPA in `src/`, one Express app in `server/src/` served by `server/dev.ts` and `api/index.ts`, tests in `src/tests/` (jsdom) and `server/tests/` (node), one-off scripts in `scripts/`.

Relative imports under `server/` carry explicit `.js` extensions. No semicolons, single quotes, 100 columns — run `npm run format` rather than hand-wrapping.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the three things every later phase assumes. All independent of each other.

- [x] T001 [P] Declare `map_opened { scope: 'zone' | 'trip'; pin_count: number; missing_coords: number }` and `map_pin_opened { category: Category }` in `src/lib/analytics-events.ts`, in a commented section beside `trip_exported`. Declare them **before** any call site exists — `capture` is typed against this catalogue and will not compile against an undeclared name. No coordinate, name or address is a property (research R9).
- [x] T002 [P] Add `"backfill:coords": "tsx scripts/backfill-coords.ts"` to the `scripts` block of `package.json`, and add `scripts/.backfill/` to `.gitignore` — journals are local operational records, not source.
- [x] T003 [P] Document the relied-upon behaviour in `specs/001-japan-trip-app/contracts/api.md` for `GET /api/trips/:tripId/zones/:zoneId/places`: an empty `category` means every category; `lat`/`lng` are returned as `null` rather than omitted; a caller whose `TripView` withholds stays never receives a `hotel`. This is the contract source of truth and is currently silent on all three.

**Checkpoint**: nothing user-visible has changed. `npm test`, `npm run typecheck` and `npm run lint` all pass.

---

## Phase 2: Foundational — coordinates, and permission to ask (Blocking Prerequisites)

**Purpose**: 0 of 39 places carry coordinates, new places acquire none, and the deployed site forbids its own pages from asking where the traveller is. Every story below is a lie until this phase lands.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete. It is also deliberately **independent of the map** — nothing here imports `src/map/`, so Slice A ships and reverts on its own.

**Serves**: the spec's Foundational block, FR-001 to FR-006.

### Tests

- [x] T004 [P] Write `server/tests/geocode-resolve.test.ts` covering `resolvePlaceLocation` through the `setGeocoder` seam: returns the best candidate for a name + address, returns `null` when nothing matches, passes the zone's coordinates through as the bias, and does not throw when the upstream is unreachable. Fails until T005.

### Implementation — resolving a location

- [x] T005 Add `resolvePlaceLocation({ name, address, near })` and the `setGeocoder()` test seam to `server/src/services/geocode.ts`, built over the existing `geocodeSearch`. Keep it under twenty lines: pick the best candidate, return `null` otherwise. **The rate limit belongs to the caller, not here** — this function is called once per place by the script and once per save by the form. Do not touch `server/src/routes/geocode.ts`.

### Implementation — the backfill

- [x] T006 Create `scripts/backfill-coords.ts` following the `scripts/seed.ts` shape (`loadEnv()`, then a dynamic import of the server modules). Read every place through `getDataStore()`, resolve each one via `resolvePlaceLocation` biased by its zone's coordinates, and print what it _would_ write. **`--dry-run` is the default; writing requires an explicit `--apply`.**
- [x] T007 Add journalling to `scripts/backfill-coords.ts`: under `--apply`, write every change to `scripts/.backfill/<timestamp>.json` as `{ id, name, before: { lat, lng }, after: { lat, lng } }`, and print the journal path on exit.
- [x] T008 Add `--revert <journal>` to `scripts/backfill-coords.ts`, restoring `before` for every row in the named journal. This is the rollback lever for the only production write in the feature (plan → Quick rollback, lever 6).
- [x] T009 Make `scripts/backfill-coords.ts` idempotent and honest: skip a place that already has coordinates (so a re-run is safe and an interrupted run resumes), throttle to one request per second per the Nominatim policy, and close with a summary of resolved / skipped / **unresolved listed by name** (FR-002).
- [x] T010 Run the full cycle from `quickstart.md` §A1 against the memory store — dry run, `--apply`, `--apply` again (expect "already located, skipped"), then `--revert`. Confirm every place returns to `lat: null`. **A revert that does not restore cleanly means the script is not ready to point at production.**

### Implementation — the location picker

- [x] T011 [P] Write `src/tests/location-picker.test.tsx`: debounces before searching, lists candidates, requires an explicit pick, reports "nothing found", and emits nothing when the field is left untouched. Fails until T012.
- [x] T012 Extract `src/components/LocationPicker.tsx` from the destination field in `src/pages/JourneySteps.tsx` (lines ~154–195) — debounce, search, result list, selection — with the bias coordinates and the placeholder as props. **A behaviour-preserving extraction, nothing more.**
- [x] T013 Point `src/pages/JourneySteps.tsx` at `LocationPicker` and delete the inlined version. `src/tests/journey-editor.test.tsx` must pass **unchanged** — that is what makes this a refactor rather than a rewrite (research R7).
- [x] T014 [P] Write `src/tests/place-form-location.test.tsx`: accepting a candidate sends `lat`/`lng`; choosing a different one sends that one; declining saves the place with neither; a place with no address triggers no lookup at all. Fails until T015.
- [x] T015 Wire `LocationPicker` into `src/pages/PlaceForm.tsx`, biased by the zone's coordinates, showing where the candidate landed and **storing nothing the traveller has not accepted** (FR-003). Declining, or having no address, saves the place normally with no coordinates (FR-004). The endpoint already accepts and validates both fields — this adds no server change.
- [x] T016 Render the candidate's resolved address line as the picker's default confirmation, with any mini-map as a progressive enhancement inside the same boundary. **`src/pages/PlaceForm.tsx` must not import `src/map/`** — that coupling is what would make Slice A un-revertible without Slice B.

### Implementation — the header

- [x] T017 [P] Change `Permissions-Policy` in `vercel.json` from `geolocation=()` to `geolocation=(self)`. One value; embeds stay denied; our own pages may ask (FR-006, research R5).
- [ ] T018 **(deferred — needs a preview deployment)** Verify T017 on a preview deployment, since no local test can: `curl -sI https://<preview>/ | grep -i permissions-policy` shows `geolocation=(self)`, and a phone opening the preview gets a **permission prompt**. No prompt and no error is the original bug.

### Checkpoint

- [x] T019 Run `npm test && npm run typecheck && npm run lint && npm run format`, then commit Slice A. All 39 places are located or listed by name, new places acquire a location the traveller confirmed, and the deployed site permits its own pages to ask. **No map exists yet, and nothing about the app looks different.**

---

## Phase 3: User Story 1 — See this city's places on a map and filter by type (Priority: P1) 🎯 MVP

**Goal**: a traveller standing in a city opens the map and sees what they saved there, filterable by category.

**Independent Test**: open the map in a zone, confirm a pin per located place, toggle a category off and back. Then, as a member without `can_see_stays`, confirm the response body contains no `hotel` and no hotel chip is offered.

**Serves**: FR-007, FR-010 to FR-018, FR-026.

### Tests

- [x] T020 [P] [US1] Write `src/tests/pins.test.ts` for the pure projection: `toPins` drops places with a null `lat` or `lng`, `missingCount` counts exactly those, `pins.length + missingCount === places.length` for a mixed array (SC-004), and `boundsOf` frames every pin and returns `null` for an empty list. Fails until T023.
- [x] T021 [P] [US1] Write `src/tests/nav-labels.test.ts`: five tabs or fewer yield today's labels; six yield the short set. Fails until T026.
- [ ] T022 [P] [US1] Write `server/tests/map-pins.test.ts` asserting the FR-016 guarantee on the response body of `GET /api/trips/:tripId/zones/:zoneId/places` **with no `category`**: an owner receives hotels; a viewer with `can_see_stays: false` receives none, and a non-member receives 404. **This passes immediately** — it locks in behaviour `listZonePlaces` already has, so that a later refactor cannot quietly remove it (research R1).

### Implementation — the pure core

- [x] T023 [US1] Create `src/map/pins.ts`: `toPins(places)`, `missingCount(places)`, `boundsOf(pins)`, `categoryStyle(category)`. Pure, no React, no Leaflet. `toPins` and `missingCount` walk the same array so the two counts cannot drift (data-model → `MapPin`).
- [ ] T024 [P] [US1] Create `src/map/scope.ts` with `zoneScope(...)` returning `{ kind: 'zone', pins, bounds, emptyMessage, onPinTap }`. `tripScope` arrives in US4 — the shape exists now so the page never learns to branch on scale (research R6).
- [ ] T025 [P] [US1] Create `src/map/tiles.ts` holding the OSM tile URL template and the attribution string, exported once. FR-013 makes attribution a condition of using the tiles at all, and a string duplicated across components is one that gets deleted from the wrong one.
- [x] T026 [P] [US1] Create `src/lib/nav-labels.ts`: `navLabels(tabCount)` returns the current labels at five or fewer and the short set (Alerts, Info, Docs) at six. **Shortening is a function of the count, not a separate change** — that is what makes turning the flag off a total rollback (research R8).

### Implementation — the engine boundary

- [ ] T027 [P] [US1] Create `src/map/engine.types.ts`: the `MapEngine` port — `mount`, `setPins`, `fitTo`, `setSelfMarker`, `onPinTap`, `destroy`. **No Leaflet type and no Leaflet import may appear in this file** (contracts §5).
- [ ] T028 [P] [US1] Create `src/map/engine.fake.ts` — an in-memory `MapEngine` recording calls, for every test above the boundary. It lives beside the port it implements.
- [ ] T029 [US1] Add `leaflet` and `@types/leaflet` to `package.json` dependencies and run `npm install`. Added in this phase rather than Setup so that reverting the US1 commit removes the dependency with the code that uses it.
- [ ] T030 [US1] Create `src/map/engine.leaflet.ts` implementing `MapEngine`. **The only module in the repository that imports `leaflet`.**

### Implementation — the screen

- [ ] T031 [US1] Add a `bleed` mode to `src/components/Layout.tsx` that drops `px-5 pt-1` from `<main>` for one route, so a page can reach the screen edges. The header stays; the fixed bottom nav stays; the map's sheet rests on top of it. **Do not cancel the padding with negative margins** — that hard-codes the value in a second place (plan → Complexity Tracking).
- [x] T032 [P] [US1] Add a `dot` field to `CATEGORY_META` in `src/api/types.ts` using **stock Tailwind classes** (`bg-violet-500`, `bg-sky-500`, `bg-amber-500`, `bg-pink-500`, `bg-emerald-500`). **No `tailwind.config.ts` change.** Every pin, chip, legend swatch and card dot reads from this table, so re-landing spec 009's palette later recolours the map in one edit (research R12).
- [ ] T033 [US1] Create `src/components/map/MapCanvas.tsx`: dynamically imports `engine.leaflet`, mounts it **full-bleed** inside the `bleed` layout, and renders the offline fallback — the sheet expanded to full height with the card row as a vertical list and the explanation above it (FR-026, research R11). Never a grey square, never a bare spinner.
- [ ] T034 [P] [US1] Create `src/components/map/MapTopBar.tsx` per `reference/map-2a-full-bleed-explore.png`: a white pill search field on the left routing to the existing `/search`, and a two-segment toggle on the right — active segment solid dark with white text, inactive white with dark text. **The segments read `City` and `Trip`, not `Day` and `Trip`** (research R13). The `Trip` segment is inert until US4; wire it there.
- [ ] T035 [P] [US1] Create `src/components/map/MapLegend.tsx`: the small floating white card over the map's right side, one `CATEGORY_META.dot` swatch and label per category present. Hidden for a category the caller's view withholds (FR-017).
- [ ] T036 [US1] Create `src/components/map/MapSheet.tsx`: the peeking bottom sheet — rounded top corners, a short centred grab handle, resting above the fixed nav. It holds the chips, the missing-count line (US5) and the card row. Two states only: peeking and expanded.
- [ ] T037 [P] [US1] Create `src/components/map/CategoryChips.tsx` as the row inside the sheet: `All` active as a solid dark pill, the rest as `CATEGORY_META.color` tinted pills, horizontally scrollable at 320px. Offers only the categories actually present in the current view (FR-010, FR-017) and filters client-side over the list already fetched.
- [ ] T038 [P] [US1] Create `src/components/map/PlaceCardRow.tsx`: the horizontal scrolling row under the chips. Each card white and rounded, with a `CATEGORY_META.dot` dot, the place name in bold and a quieter second line (`CATEGORY_META.singular` · the zone's name). Leave the row visibly cut at the right edge so it reads as scrollable, exactly as the render draws it.
- [ ] T039 [US1] Create `src/pages/TripMap.tsx`: read the zone's places with the existing hook (no `category`), hold the scope, the active filters and the selected place, and compose the 2a elements. **Orchestration only** — a `.filter(` or a `Math.min(` appearing here belongs in `pins.ts` (plan → Small methods).
- [ ] T040 [US1] Add `RequireMap` to `src/router.tsx`, modelled line-for-line on `RequireExport`, plus the `/trips/:tripId/map` route behind it. `useBooleanFlag('show-map', false)` — gating the entry points _and_ the route, so a bookmark is closed too.
- [ ] T041 [US1] Add the sixth tab to `src/components/Layout.tsx` behind the same flag, and route every tab label through `navLabels(tabs.length)` (FR-012). Build the tab list first, then ask it how many there are.
- [ ] T042 [US1] Send `map_opened { scope, pin_count, missing_coords }` from `src/pages/TripMap.tsx` through the `src/lib/posthog.ts` helpers — never `posthog.capture` directly.

### Implementation — the guarantee

- [ ] T043 [US1] Move the inline place literal out of `listZonePlaces` (`server/src/services/zones.ts`) into `zonePlaceListItem()` in `server/src/lib/place-view.ts`, driven by an explicit `Record<keyof Place, 'list' | 'omit'>` policy. Behaviour-preserving; the point is that adding a column to `Place` now fails `npm run typecheck` until someone decides (data-model → field policy, plan → Complexity Tracking).
- [ ] T044 [US1] Confirm T043 works as intended: temporarily add a field to the `Place` interface in `server/src/lib/datastore.ts`, run `npm run typecheck`, see it fail, then remove it. **A guard nobody has watched fail is not a guard.**

### Tests over the finished screen

- [ ] T045 [P] [US1] Write `src/tests/map.test.tsx` against `engine.fake`: pins for a zone's located places, a category toggle removing and restoring only its own, the empty-zone message, and the offline fallback listing the places.
- [ ] T046 [P] [US1] Write `src/tests/map-flag.test.tsx`, mirroring `src/tests/export-flag.test.tsx`: flag off → no tab and the route redirects to the trip; flag on → both present.

### Checkpoint

- [ ] T047 [US1] Compare the built screen side by side with `reference/map-2a-full-bleed-explore.png` at 375px: full-bleed map, floating top bar, floating legend, peeking sheet with handle, tinted chips, cut-off card row. **The pin hues will not match the render** — it was drawn against the redesign palette that PR #94 reverted, and shipping on the stock colours is a decision, not a defect (research R12). Everything else should match.
- [ ] T048 [US1] Run `npm run build` and confirm the entry chunk is still ~233 KB gzip with Leaflet and `src/map/*` as separate chunks. **A grown entry chunk means something imported the engine statically** — find it before shipping.
- [ ] T049 [US1] Confirm `src/map/*` is **not** added to the Workbox precache in `vite.config.ts`. Unlike `src/export/`, precaching it buys nothing: its tiles cannot come with it under the tile policy (research R4).
- [ ] T050 [US1] Run the full gate, walk `quickstart.md` §B1–B5 including the devtools check that a restricted viewer's response body contains no `hotel`, then commit Slice B. **US1 is shippable on its own — this is the MVP.**

---

## Phase 4: User Story 2 — See where I am relative to what I saved (Priority: P2)

**Goal**: the traveller's own position on the map, so "near" means near them.

**Independent Test**: grant location, confirm the marker appears and the map moves to include it; deny it, confirm the map stays fully usable and says what is unavailable.

**Serves**: FR-022 to FR-025. Depends on Phase 2's header fix (T017) and on US1's screen.

### Tests

- [ ] T051 [P] [US2] Write `src/tests/geolocation.test.ts` over a stubbed `navigator.geolocation`: each of `idle`, `asking`, `granted`, `denied`, `unavailable` is reachable, a refusal is not retried within the visit (FR-023), and a timeout reads as `unavailable`, not `denied`. Fails until T052.

### Implementation

- [ ] T052 [US2] Create `src/lib/geolocation.ts` exposing `requestPosition()` and the `PositionState` discriminated union (data-model). **Permission as data, not as exceptions**, so every branch of FR-022 to FR-025 is a rendered case rather than a `catch`.
- [ ] T053 [US2] Implement `setSelfMarker` in `src/map/engine.leaflet.ts` and `src/map/engine.fake.ts` — visually distinct from place pins.
- [ ] T054 [US2] Add the FR-025 framing rule to `src/map/pins.ts`: a self position far outside the current bounds does not widen them. The saved places stay the subject; the traveller gets a control to move to themselves. **The rule lives here, not in the component.**
- [ ] T055 [P] [US2] Create `src/components/map/LocateButton.tsx` — a small circular floating control on the map, in `MapLegend`'s floating idiom so it does not read as a new species of control. **Not in the 2a render**; US2 needs it (plan → departure 4).
- [ ] T056 [US2] Wire it into `src/pages/TripMap.tsx`: the position is requested only when asked for, never on mount, and a `denied` or `unavailable` state renders a plain line rather than an error screen (FR-024).
- [ ] T057 [P] [US2] Write `src/tests/map-position.test.tsx`: granted shows the marker and recentres; denied leaves every pin and filter working and states the position is unavailable; the map is never asked for a position on mount.

### Checkpoint

- [ ] T058 [US2] Run the gate and `quickstart.md` §C1 — including the devtools sensors check that a far-away position does not zoom the map out to span both — then commit.

---

## Phase 5: User Story 3 — Go from a pin to the place, or to directions (Priority: P2)

**Goal**: a pin is a way in, not a dead end.

**Independent Test**: tap a pin, confirm the summary matches that place, follow the place link, follow the directions link into an external maps app.

**Serves**: FR-011. Depends on US1's screen.

### Tests

- [ ] T059 [P] [US3] Extend `src/tests/maps.test.ts` for `directionsUrl`: coordinates when the place has them, the name + address + city text query when it does not, and correct encoding of both. Fails until T060.

### Implementation

- [ ] T060 [US3] Add `directionsUrl(...)` to `src/lib/maps.ts` beside `placeMapsUrl` — `https://www.google.com/maps/dir/?api=1&destination=…`, so directions open directly rather than a search the traveller must tap through (research R10, SC-008). Leave `placeMapsUrl` and its two callers alone.
- [ ] T061 [US3] Add the expanded state to `src/components/map/PlaceCardRow.tsx`: a selected card grows to show name, category, address, the existing `summary_line`, a link to the place's own screen and a link to directions. **Not a second sheet** — 2a already has one and an overlay would cover it (research R13). It renders what the list already returned — **it does not fetch the place again**.
- [ ] T062 [US3] Wire `MapEngine.onPinTap` through `src/pages/TripMap.tsx` so tapping a pin scrolls `PlaceCardRow` to that place and expands its card — and tapping a card selects its pin, so the two stay in step in both directions. Send `map_pin_opened { category }`.
- [ ] T063 [P] [US3] Write `src/tests/map-pin-sheet.test.tsx`: tapping a pin shows that place's summary, both links carry the right targets, and dismissing the sheet leaves the map where it was.

### Checkpoint

- [ ] T064 [US3] Run the gate and `quickstart.md` §C2, counting the taps from pin to directions against SC-008's budget of two, then commit Slice C.

---

## Phase 6: User Story 4 — See the whole trip's cities and zoom into one (Priority: P3)

**Goal**: the shape of the whole journey on one map, and a way into one stop.

**Independent Test**: switch to whole-trip, confirm one pin per zone; tap one and confirm the map moves to that zone's places.

**Serves**: FR-008, FR-009. Needs no new request — the bundle already carries every zone's coordinates.

### Tests

- [ ] T065 [P] [US4] Write `src/tests/scope.test.ts`: `tripScope` yields one pin per zone with a located zone count; `defaultScope` picks the current step's zone during the trip, the next one before it, and the first when the trip has not started; both scopes return the same shape. Fails until T066/T068.

### Implementation

- [ ] T066 [US4] Add `tripScope(...)` to `src/map/scope.ts`, built from the trip bundle's `steps[].zone`, with `onPinTap` switching the page to that zone's `zoneScope` (FR-009). **No new request** (contracts §2).
- [ ] T067 [US4] Render the trip scale in 2c's vocabulary inside 2a's frame: one circle per city **sized by how much is saved there**, carrying the count, with a name pill beneath (`reference/map-2c-city-chapters.png`). The card row becomes one card per city with its count. Do **not** port `projectStops` from the reverted PR #93 — it exists because that build had no tiles; Leaflet owns the projection here (plan → carried forward).
- [ ] T068 [US4] Add `defaultScope(...)` to `src/map/scope.ts` — current or next journey step's zone, falling back to the first (FR-008). A pure function of the steps and today's date.
- [ ] T069 [US4] Activate the `Trip` segment of `MapTopBar` (inert since T034) in `src/pages/TripMap.tsx`. The page swaps one `MapScope` for another and renders identically — **if this needs an `if (scope.kind === …)` anywhere but the toggle itself, the strategy has leaked** (research R6).
- [ ] T070 [P] [US4] Write `src/tests/map-scales.test.tsx`: the whole-trip view shows one pin per zone; tapping one moves to that zone's places; a freshly opened map is on the current step's zone, not the whole trip.

### Checkpoint

- [ ] T071 [US4] Run the gate and `quickstart.md` §D1, then commit.

---

## Phase 7: User Story 5 — Know which places are missing from the map (Priority: P3)

**Goal**: the map never quietly under-reports what was saved.

**Independent Test**: with a place lacking coordinates, confirm the count is stated, opening it lists exactly those places, and a row leads to where a location can be set.

**Serves**: FR-019 to FR-021.

### Tests

- [ ] T072 [P] [US5] Write `src/tests/map-missing.test.tsx`: the count appears only when something is missing (FR-019's fourth scenario); it lists exactly the places lacking coordinates; a row links to that place's edit route; for a member who cannot edit the count is stated and leads nowhere (FR-021). Fails until T073/T074.

### Implementation

- [ ] T073 [US5] Create `src/components/map/MissingPlaces.tsx`: a line **directly under the chip row, always visible in the sheet's peeking state** — not a card at the end of the scrolling row, which FR-019 would not count as stated on the map (research R11). Behind it, the list, each row linking to `/trips/:tripId/places/:placeId/edit`. **No second location editor** — the picker from Phase 2 already lives on that screen (the user's settled clarification).
- [ ] T074 [US5] Render it from `src/pages/TripMap.tsx` using `missingCount` from `pins.ts`, gated on `useCanEdit()` for the interactive half only. The count itself is shown to everyone.
- [ ] T075 [US5] Verify the arithmetic of SC-004 by hand in a zone containing a hidden stay: pins on screen + missing count = the places that member can see. This is the number that proves the map is not under-reporting, and the hidden-stay case is the one where it is easy to get wrong.

### Checkpoint

- [ ] T076 [US5] Run the gate and `quickstart.md` §D2–D3, then commit Slice D.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T077 Check every 2a element against `reference/map-2a-full-bleed-explore.png` once more on a real phone, and confirm the six documented departures are all present and that none has quietly grown a seventh: `City`/`Trip` labels, search routing to `/search`, tile attribution, the locate button, the missing-count line, and 2c's clusters at the trip scale.
- [ ] T078 Walk `quickstart.md` end to end on a preview deployment, including §B3 at **375px and 320px** — SC-006's legibility cannot be proven in jsdom and is verified here.
- [ ] T079 [P] Add a Map paragraph to `CLAUDE.md` in the style of the existing feature notes: no migration, the engine port and why it exists, why tiles are never precached, and that the nav labels shorten as a function of tab count.
- [ ] T080 [P] Update `README.md` with the `npm run backfill:coords` workflow — dry run, apply, revert — since it is the one command in this feature that writes to production data.
- [ ] T081 Re-read every diff in the feature adversarially against `src/map/engine.types.ts`: confirm nothing outside `src/map/engine.leaflet.ts` imports `leaflet`, and that `src/pages/PlaceForm.tsx` still does not import `src/map/`.
- [ ] T082 Confirm each slice reverts cleanly in a scratch branch: revert Slice D, then C, then B, and check the app still builds and its tests pass at each step. **A rollback plan nobody has executed is a hypothesis** (plan → Quick rollback).
- [ ] T083 Confirm the code default for `show-map` is `false` at **both** call sites — `src/components/Layout.tsx` and the `RequireMap` guard in `src/router.tsx` — and that it stays that way. **Decided by the user: the default is off permanently and the map appears only when `show-map` is turned on explicitly in PostHog.** There is no later commit that flips it to `true`; PostHog is the only switch. The accepted consequences: the map is invisible in local dev and on any deploy without `VITE_POSTHOG_PROJECT_TOKEN`, and on a device's first run the tab is absent until flags arrive and stays absent if that fetch fails.
- [ ] T084 Final gate — `npm test && npm run typecheck && npm run lint && npm run format` — and confirm no debug flag flips (`useBooleanFlag('show-map', true)`) survived from local development.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** — no dependencies; all three tasks parallel.
- **Foundational (Phase 2)** — depends on Setup. **Blocks every user story.** Independent of `src/map/` by design, so it ships and reverts alone.
- **US1 (Phase 3)** — depends on Phase 2. The MVP.
- **US2, US3 (Phases 4–5)** — depend on US1 for the screen; independent of each other and parallelisable.
- **US4 (Phase 6)** — depends on US1 for the screen and on `scope.ts` from T024.
- **US5 (Phase 7)** — depends on US1 for `missingCount`; independent of US2, US3 and US4.
- **Polish (Phase 8)** — after the stories you intend to ship.

### An honest deviation from the template

The template's ideal is stories that are independent of one another. Here **US2 to US5 all depend on US1**, because they are additions to a screen US1 creates: a self-marker, a pin sheet, a second scale and a missing-count all need a map to be on. This is stated rather than papered over. What _is_ preserved is the property that matters — US1 ships alone and delivers the job the feature exists for, and each later story is a separate revertible commit on top.

### Within each story

Tests come before the code they cover, except T022 and T044, which are regression locks over behaviour that already exists and pass on arrival. Pure modules (`pins.ts`, `scope.ts`, `nav-labels.ts`, `geolocation.ts`) come before the components that consume them — that is what keeps the components thin enough to be worth the name.

---

## Parallel Opportunities

```bash
# Phase 1 — all three, immediately
T001 analytics catalogue · T002 npm script + gitignore · T003 api.md contract note

# Phase 2 — two independent tracks after T005
Track A (backfill):  T006 → T007 → T008 → T009 → T010
Track B (picker):    T011 → T012 → T013 → T014 → T015 → T016
T017 (vercel.json) is parallel to both.

# Phase 3 — the pure core, all in different files
T020 pins.test · T021 nav-labels.test · T022 server map-pins.test
T024 scope.ts · T025 tiles.ts · T026 nav-labels.ts · T027 engine.types · T028 engine.fake

# Phase 3 — the 2a elements, once T031 (bleed) and T032 (CATEGORY_META.dot) are in
T034 MapTopBar · T035 MapLegend · T037 CategoryChips · T038 PlaceCardRow
(T036 MapSheet holds the last two; T033 MapCanvas needs T031)

# Phases 4 and 5 — different files throughout, two people or two sittings
US2: T051 → T052 → T053 → T054 → T056 → T057
US3: T059 → T060 → T061 → T062 → T063
```

Not parallel, whatever it looks like: T039, T056, T062, T069 and T074 all edit `src/pages/TripMap.tsx`, and T029/T030 must precede anything that mounts a real engine. Within US1, T031 (the `bleed` mode) must land before T033 mounts a full-bleed map inside it, and T032 (`CATEGORY_META.dot`) before T034–T038 draw a pin, a chip, a swatch or a card dot.

---

## Implementation Strategy

### MVP first

1. Phase 1 (Setup) — three small tasks.
2. Phase 2 (Foundational) — **the real work of this feature.** Coordinates exist, new places get them, the header is fixed. Nothing looks different yet.
3. Phase 3 (US1) — the map, the filters, the tab.
4. **Stop and validate**: `quickstart.md` §B, including the restricted-viewer response-body check.
5. Ship with `show-map` off, turn it on for one device, use it.

### Incremental delivery

Each phase after the MVP is one commit that leaves the app working: US2 (you are here) → US3 (the way out) → US4 (the whole trip) → US5 (what is missing). Any of them can be skipped or deferred without stranding the others, and any can be reverted alone.

### Rollback, at any point

`show-map` off in PostHog removes the tab and closes the route with no deploy. Below that: revert one slice's commit; revert the backfill with its journal; revert one line of `vercel.json`. There is no migration, so there is no schema rollback to get wrong. T082 exists so that this is a rehearsed procedure rather than a paragraph.

---

## Notes

- `npm run typecheck` is not optional and `npm test` cannot replace it: Vitest transpiles types away, so the field policy in T043 fails only there.
- Never call `posthog.capture` directly — go through the helpers in `src/lib/posthog.ts`, or an unconfigured build calls into an uninitialised client.
- A new mutation gets its toast from `meta`; none of these tasks add a mutation, and the location picker rides on the existing place save.
- Commit at each checkpoint task, not at each task. The checkpoints are the revert boundaries.
