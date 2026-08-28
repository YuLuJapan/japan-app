# Implementation Plan: Map

**Branch**: `claude/task-004-monday-y5ra89` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-trip-map/spec.md`

## Summary

Put the trip's saved places on a map, at two scales, behind a kill switch.

The surprise on reading the code is how little server work this needs. `GET /api/trips/:tripId/zones/:zoneId/places` already accepts an empty category, already returns `lat`/`lng`, and already drops stays for a member whose view withholds them; the trip bundle already spreads each step's whole zone, coordinates included. So FR-007, FR-008 and FR-016 are one endpoint call and one bundle read, not a new API. Places already carry `lat`/`lng` columns with range validation on write. There is no migration in this feature and nothing to roll back in the database.

What is actually missing is: coordinates in those columns (0 of 39), a way for new places to get them, a deployed site that does not forbid its own pages from asking for the traveller's position, and the screen itself.

The approach is four independently revertible slices, in dependency order, with the riskiest thing — a script that writes to production rows — made reversible by construction rather than by care.

## The design reference

The Monday item gained a design update after this plan was first written. It comes from `Onward Redesign Options.dc.html` — the same exploration file spec 009 draws on — and offered three arrangements without picking one. **The user picked 2a · Full-bleed explore.** The three renders are committed alongside this plan so it stands on its own:

- [`reference/map-2a-full-bleed-explore.png`](./reference/map-2a-full-bleed-explore.png) — **the one being built**
- [`reference/map-2b-split-map-list.png`](./reference/map-2b-split-map-list.png), [`reference/map-2c-city-chapters.png`](./reference/map-2c-city-chapters.png) — not taken
- [`reference/sheet-map-directions.png`](./reference/sheet-map-directions.png) — all three side by side

They were rendered at 300px device width and 2× scale from the design's own webfonts, so they are a faithful phone-width reading rather than a desktop mock.

### What 2a draws, element by element

Reading the render top to bottom. Everything here is a target, not a suggestion — where this plan departs from it, the departure is named and argued in the next section.

| Element      | As drawn                                                                                                                                                                                                                                                | Where it lives     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| The map      | Full-bleed. It reaches every edge; nothing is inset over it.                                                                                                                                                                                            | `MapCanvas`        |
| Top bar      | Floating over the map: a white pill search field on the left, a two-segment toggle on the right (active segment solid dark with white text, inactive white with dark text)                                                                              | `MapTopBar`        |
| Pins         | Solid category-coloured discs, white ring, soft drop shadow — not teardrops, not icons                                                                                                                                                                  | `pins.ts` → engine |
| Legend       | A small white rounded card floating over the map's right side, one coloured dot and label per category                                                                                                                                                  | `MapLegend`        |
| Bottom sheet | Peeking, rounded top corners, a short grab handle centred at the top                                                                                                                                                                                    | `MapSheet`         |
| Filter chips | A row inside the sheet: `All` active as a solid dark pill, the rest as category-tinted pills                                                                                                                                                            | `CategoryChips`    |
| Place cards  | A horizontally scrolling row under the chips, each a white rounded card with a coloured dot, the place name in bold, and a quieter second line (`Stay · 2 nights`, `Do · Tokyo`). The row is deliberately cut off at the right edge to show it scrolls. | `PlaceCardRow`     |

### Where this plan departs from 2a, and why

Six departures. Each is either something the render could not know, or something a story requires that the render has no slot for.

1. **The segments read `City` / `Trip`, not `Day` / `Trip`.** The render labels the left segment "Day", which implies scoping pins to one date — 2b's day chips do exactly that. No requirement in this spec asks for it, and FR-008 defines the two scales as _the current step's zone_ and _the whole trip_. Keeping the label "Day" over a control that switches cities would be a lie in two words. Same control, same place, same styling; honest labels.
2. **The search field opens the existing trip search.** 2a draws "Search Japan…" but the render cannot say what it searches. Building map-specific search would be a new requirement; leaving a dead field on screen is worse. It routes to `/search`, which already exists. **Known cosmetic duplication**: the app header already carries a magnifier, so this screen offers two ways into the same search. Spec 009 restyles that header anyway. Filtering pins by name client-side was considered and rejected as scope this spec does not carry.
3. **Attribution is added.** The render has none, being a mock. FR-013 makes it a condition of using the tiles at all, so it sits along the map's bottom edge, above the sheet.
4. **A locate control is added.** US2 needs one and 2a draws none. A small circular floating button on the map, in the legend card's floating idiom so it does not read as a new species of control.
5. **The missing-places count gets a line of its own**, directly under the chip row, always visible in the peeking state. FR-019 says the count must be _stated on the map_; the last card in a horizontal row that must be scrolled to is not stated. This is the one element 2a has no room for, and giving it a scrolling position would quietly break the requirement it exists to serve.
6. **The whole-trip scale borrows 2c's vocabulary.** 2a renders only the city scale. Rather than invent a second visual language for the `Trip` segment, it uses the design's own answer from 2c — one circle per city, sized by how much is saved there, with a name pill beneath — drawn inside 2a's full-bleed frame. The card row becomes one card per city. This is the design file answering a question its own 2a render left open.

### Two things the render cannot show, that the code has to get right

**Colours.** The reference renders use the redesign's category palette — slate blue for stays, olive for things to do, terracotta for food, ochre for shopping. Those tokens arrived with PR #93 and left with its revert in PR #94; `main` is back to stock Tailwind violet/sky/amber/pink. **The user chose to ship on the stock colours** rather than pull redesign tokens into this feature. So the map's arrangement will match the reference and its hues will not, until spec 009 re-lands.

What makes that a deferral rather than a debt: **every pin, chip, dot and legend swatch reads its colour from `CATEGORY_META`**, never from a map-local palette. `CATEGORY_META` today carries a tint pair per category (`bg-violet-100 text-violet-700`); the map needs a solid fill too, so it gains a `dot` field using stock Tailwind classes (`bg-violet-500`, …) — **no `tailwind.config.ts` change, no new token**. When 009 re-lands its palette, one edit to that table recolours the map, the chips and the legend together, and the map will match the render exactly with no map code touched.

**Full-bleed has to escape the app frame.** `Layout` wraps every page in `<main class="page-transition flex-1 px-5 pb-28 pt-1">`, so a page cannot reach the screen edges today, and the bottom nav is `fixed`. The map therefore needs a `bleed` mode on `Layout` that drops the horizontal padding and the top spacing for this route only, with the sheet resting on top of the nav rather than under it. The existing header stays: it carries the trip name and the way back out, and dropping it on one screen would be a worse inconsistency than a duplicated magnifier.

### What is carried forward from the reverted PR #93, and what is not

PR #93 built 2c and was reverted whole in PR #94. Two things from it are worth knowing:

- **`projectStops` is not carried forward.** It projects lat/lng onto a percentage field because that implementation had _no tiles underneath_. With a real tile layer, Leaflet owns the projection and a hand-rolled linear one would fight it. What _is_ carried forward is the cluster's visual treatment — a sized, counted circle with a name pill — which is what departure 6 above adopts.
- **The flag differs, and ours wins.** PR #93 used `trip-map` defaulting **on**, a kill switch. This feature uses `show-map` defaulting **off**, settled explicitly with the user: the map appears only where PostHog turns it on. `trip-map` no longer exists on `main`, so there is no collision — but the two were never the same decision and should not be conflated.

## Technical Context

**Language/Version**: TypeScript 5, React 18, Node 20 (ESM; relative imports under `server/` carry explicit `.js`)

**Primary Dependencies**: existing — React Router, TanStack Query, Tailwind, Express, Supabase JS, PostHog, `vite-plugin-pwa`. New — `leaflet` (~42 KB gzip) and `@types/leaflet`, both reachable only through a dynamic import. No React wrapper (`react-leaflet`) — see research R3.

**Storage**: no change. `places.lat` / `places.lng` and `zones.lat` / `zones.lng` already exist (`server/src/lib/datastore.ts`). **No migration in this feature.**

**Testing**: Vitest, two projects — `server` (node + supertest against `createApp()` with the fixture store), `web` (jsdom + React Testing Library, `renderAt` from `src/tests/helpers.tsx`). Plus `npm run typecheck`, which is where the field-policy guard fails.

**Target Platform**: installed PWA on a phone, 320px and up; Vercel Hobby serverless for the API.

**Project Type**: web application — React SPA + one Express app served two ways (`server/dev.ts`, `api/index.ts`).

**Performance Goals**: entry chunk unchanged (~233 KB gzip) — every byte of map code arrives on demand. Map interactive within 2s of tapping the tab on a warm cache. 39 places today, low hundreds at the ceiling; no clustering needed at that size.

**Constraints**: $0 of new spend — free OSM raster tiles, no mapping account, no key. Tile terms forbid bulk pre-fetching, so map imagery stays out of the Workbox precache. Nominatim allows 1 request/second, which is what forces the backfill out of a request and into a script.

**Scale/Scope**: 39 places / 9 zones / 1 live trip. ~14 new source files, ~6 touched, one script, one line of `vercel.json`.

## Constitution Check

`.specify/memory/constitution.md` is still the unedited Spec Kit placeholder — no principles have been ratified, so there is no project constitution to gate against. In its place this plan is checked against the standards the repository actually enforces (`CLAUDE.md`, and the patterns the 001–003 features established). Each is a gate; each is re-checked after Phase 1 at the bottom of this file.

| #   | Gate (from CLAUDE.md)                                                                       | How this plan satisfies it                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Routes stay thin; services validate; the store is reached only via `getDataStore()`         | No new route and no new service. The one server change is a projection helper in `lib/`.                                                                                                                           |
| G2  | Anything returning a place, a place id or a file gets the `TripView` treatment              | The pins come from `listZonePlaces`, which already filters stays. Slice 2 adds the tests that make that a guarantee rather than a coincidence, and a field policy that makes a new `Place` column a compile error. |
| G3  | A write answers with the shape its list renders                                             | No new writes. `PATCH /places/:id` already answers with `placeView`, which is what the location picker saves through.                                                                                              |
| G4  | New events are declared in `analytics-events.ts` first; properties are shape, never content | `map_opened` / `map_pin_opened` declared before their call sites; properties are two enums and three counts. No place name, no address, no coordinates — a coordinate _is_ content.                                |
| G5  | Flags default off; the default is the answer when PostHog has none                          | `show-map` defaults `false`, gating both the tab and the route, exactly as `export-trip` does.                                                                                                                     |
| G6  | `npm run typecheck` is part of the test path                                                | The field policy in `place-view.ts` fails there, not in `npm test`.                                                                                                                                                |
| G7  | Everything fits the free tier                                                               | OSM tiles, no key, no account, no new infrastructure.                                                                                                                                                              |
| G8  | No semicolons, single quotes, 100 cols; `_`-prefix for intentionally unused                 | `npm run format` and `npm run lint` before each commit.                                                                                                                                                            |

**Result: PASS.** One deviation is recorded in Complexity Tracking.

## How this gets built: the code-quality contract

The user's brief for this plan was clean code, design patterns where they earn their place, small methods, and quick rollback. Those are not decoration here; they decide the file layout.

### Layering, and the one dependency boundary that matters

Leaflet is the only new third-party thing in this feature, and it is the thing most likely to be swapped, dropped, or to break in a test environment (jsdom has no layout, so a real map cannot mount there). It gets a boundary:

```text
src/map/engine.types.ts   ← MapEngine: the port. No leaflet types, no DOM types.
src/map/engine.leaflet.ts ← the only module in the repo that imports 'leaflet'.
src/map/tiles.ts          ← tile URL + the attribution string, in one place (FR-013)
src/map/pins.ts           ← pure. places → pins, category → marker style, pins → bounds
src/map/scope.ts          ← pure. the two scales, as data
```

`engine.types.ts` declares roughly six methods — `mount`, `setPins`, `fitTo`, `setSelfMarker`, `onPinTap`, `destroy` — and nothing else. Everything above the boundary programs against that interface, so:

- every test runs against a fake engine, deterministically, with no canvas and no network;
- swapping Leaflet for MapLibre later is one file;
- deleting the feature is `rm -r src/map` plus a route and a tab.

This is the **adapter/port** pattern, and it is the only structural pattern in the feature that is not already in the repo. It is here because there is a real seam to defend, not because maps usually have one.

### The patterns used, and the ones deliberately not

| Pattern                   | Where                                                                                                             | Why it earns its place                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Port/adapter              | `MapEngine` + `engine.leaflet.ts`                                                                                 | A swappable, untestable-in-jsdom dependency. Also the rollback lever.                                                                                                                                                 |
| Strategy                  | `src/map/scope.ts` — `zoneScope(...)` and `tripScope(...)` both return `{ pins, bounds, emptyMessage, onPinTap }` | FR-008/009 put two scales on one screen. Without it, `if (scope === 'trip')` grows through the render, the bounds maths and the tap handler. With it, the page renders one shape and never asks which scale it is on. |
| Pure projection functions | `pins.ts`, `scope.ts`, `lib/nav-labels.ts`, `lib/geolocation.ts`                                                  | The repo's own idiom (`lib/ordering.ts`, `lib/flight-draft.ts`, `export/outline.ts`): all the logic worth testing lives in functions that take data and return data, and the components stay dumb.                    |
| Test seam by setter       | `setGeocoder()` in `services/geocode.ts`                                                                          | Same idiom as `setDataStore()` / `setTokenVerifier()`. Lets the backfill's resolution logic be tested without touching Nominatim.                                                                                     |
| Compile-time field policy | `Record<keyof Place, …>` in `lib/place-view.ts`                                                                   | Established by `export-view.ts` for exactly this risk: a new `Place` column reaching a wire nobody re-audited.                                                                                                        |

Not used, on purpose: no state-machine library (three booleans and a scope enum), no context provider for map state (one page owns it; props reach every consumer in two hops), no repository or DI container on the server (the store interface is already that), no clustering library (39 pins), no `react-leaflet` (research R3).

### Small methods, concretely

The rules this feature is written to, and how they are checked:

- **One exported concern per module.** `pins.ts` does not know what a zone is; `scope.ts` does not know what a marker looks like; `TripMap.tsx` does no geometry and no filtering.
- **Functions under ~20 lines, one reason to change.** The bounds calculation, the category filter, the missing-count and the default-scope choice are four functions, not four branches of one `useMemo`.
- **No logic in JSX.** A component that needs a derived value gets it from a named function above the return.
- **The page component orchestrates and nothing else.** `TripMap.tsx` holds state, wires callbacks and chooses which component to render. If it grows a `.filter(` or a `Math.min(`, that belongs in `pins.ts`.
- **Checked, not hoped for**: every one of those pure modules gets a unit test with no React in it, which is only pleasant to write if the functions are small. The friction is the check.

### Quick rollback, by construction

Seven levers, cheapest first. The point of the ordering is that the expensive ones are almost never needed.

1. **The flag, with no deploy.** `show-map` off in PostHog removes the tab _and_ closes the route (`RequireMap`, modelled on `RequireExport`). Seconds, no build, no revert.
2. **The code default is `false`, permanently.** Settled by the user rather than deferred: the map appears only where `show-map` has been turned on explicitly in PostHog, and there is no later commit that flips the default to `true`. So if PostHog is unreachable, unconfigured, or the flag is deleted, the feature reads as off — the failure mode of the rollback mechanism is "rolled back". The cost, accepted knowingly, is that the map is invisible in local dev and on any deploy without `VITE_POSTHOG_PROJECT_TOKEN`, and that a device which never receives flags never sees the tab; `export-trip` already lives with exactly this.
3. **Nothing is fetched when it is off.** The map chunk arrives through a dynamic `import()` inside the guarded route, so a broken map chunk cannot affect a screen that never loads it, and the entry bundle does not move.
4. **The nav labels shorten as a consequence of tab count, not as a change.** `navLabels(tabs.length)` returns today's labels for five tabs and short ones for six. Turning the flag off restores the current bar exactly, with no second thing to remember to undo. This is the design decision that keeps lever 1 total.
5. **Slice-per-commit, in dependency order.** Each of the four slices below is a `git revert` of one commit that leaves the app working. The dependency direction is stated so nothing has to be unpicked out of order.
6. **The backfill is reversible.** It is the only step that writes to production rows, so it does not rely on being right: `--dry-run` is the default, every write is journalled to a timestamped JSON file as `{ id, before, after }`, and `--revert <journal>` puts the old values back. It is idempotent (skips a place that already has coordinates), resumable, and rate-limited to one request per second.
7. **No migration, so no schema rollback exists to get wrong.** The columns are already there.

The two changes that are _not_ behind the flag are deliberate and are both one line to undo: the `vercel.json` header (narrowed from `geolocation=()` to `geolocation=(self)`, revertible on its own), and geocode-on-save in the place form (useful with or without a map — the map is what shows the coordinates off, not what makes them worth having).

## Delivery slices

Four commits, each shippable and each revertible alone.

### Slice A — Foundational: coordinates, and permission to ask where you are

_Serves the foundational block, FR-001 to FR-006. Blocks everything._

- `server/src/services/geocode.ts`: add `resolvePlaceLocation({ name, address, near })` — a small function over the existing `geocodeSearch`, returning the best candidate or `null`, plus `setGeocoder()` as the test seam. The rate limit lives in the script, not here.
- `scripts/backfill-coords.ts` + `npm run backfill:coords`: a thin shell over that function. Reads places through the datastore, biases each search by its zone's coordinates (which all 9 have), one request per second, `--dry-run` by default, `--apply` to write, journal out, `--revert <journal>` back. Prints every unresolved place by name (FR-002).
- `src/components/LocationPicker.tsx`: extracted from the destination field already in `src/pages/JourneySteps.tsx` — debounce, search, result list, selection. Extracted first as a behaviour-preserving refactor covered by the existing journey-editor tests, then consumed twice.
- `src/pages/PlaceForm.tsx`: uses it. Suggests a location from name + address on save, shows where the candidate landed, and stores nothing the traveller has not accepted (FR-003). Declining, or having no address, saves the place with no coordinates (FR-004).
- `vercel.json`: `geolocation=()` → `geolocation=(self)` (FR-006).

**Deliberately independent of the map.** The picker's contract is "show where this landed"; its default rendering is the resolved address line, with the mini-map as a progressive enhancement through the same `MapEngine` port. So Slice A ships, and reverts, without Slice B.

### Slice B — US1: the zone map, with category filters

_The MVP. FR-007, FR-010 to FR-018._

- `src/map/*` as laid out above; `leaflet` added to dependencies.
- `src/pages/TripMap.tsx`, route `/trips/:tripId/map` behind `RequireMap`, dynamic import.
- **The 2a arrangement**: full-bleed `MapCanvas`, floating `MapTopBar` and `MapLegend`, and the peeking `MapSheet` carrying `CategoryChips` and `PlaceCardRow`. Built against `reference/map-2a-full-bleed-explore.png`.
- `src/components/Layout.tsx`: the sixth tab, `navLabels(count)` (FR-012), and the `bleed` mode that lets one route drop `px-5 pt-1` and reach the screen edges.
- `src/api/types.ts`: `CATEGORY_META` gains a `dot` field (stock Tailwind classes, no token change) so pins, chips, legend swatches and card dots all read one table.
- `src/lib/nav-labels.ts`: pure, unit-tested.
- Server: extract the inline projection in `listZonePlaces` into `zonePlaceListItem()` in `lib/place-view.ts`, carrying `Record<keyof Place, 'list' | 'omit'>`. Behaviour-preserving; the point is that a new `Place` column stops the build until someone decides (G2, G6).
- `server/tests/map-pins.test.ts`: a viewer without stays receives no hotel from the all-categories sweep, and no hotel in the counts. This is FR-016's actual enforcement — asserted on what the endpoint returns, not on what the screen draws.
- Offline fallback (FR-026) and the missing-count (FR-019, its list and route in Slice D).
- `map_opened` declared and sent.

### Slice C — US2 + US3: you are here, and the way out

_FR-011, FR-022 to FR-025._

- `src/lib/geolocation.ts`: `requestPosition()` → a discriminated union of `granted` / `denied` / `unavailable`. Never called on mount (FR-023).
- Self-marker through `MapEngine.setSelfMarker`; framing rule from FR-025 lives in `pins.ts`, not in the component.
- The pin sheet is **not a new overlay**: in 2a the sheet already exists, so tapping a pin scrolls `PlaceCardRow` to that place and expands its card into the summary, the place link and the directions link. One sheet, two states.
- `src/lib/maps.ts`: add `directionsUrl(...)` beside the existing `placeMapsUrl` — the current link is a search, and FR-011 asks for a destination.
- `map_pin_opened` declared and sent.

### Slice D — US4 + US5: the whole trip, and what is missing

_FR-008, FR-009, FR-019 to FR-021._

- `tripScope(...)` in `src/map/scope.ts`, fed entirely from the bundle's steps — no new request.
- The default-scope rule (current or next step's zone, else the first) as a pure function.
- `src/components/map/MissingPlaces.tsx`: count → list → the existing place edit screen for a member who can edit; the same count, stated and inert, for one who cannot (FR-021).

## Project Structure

### Documentation (this feature)

```text
specs/004-trip-map/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions, with what was rejected
├── data-model.md        # Phase 1 — the shapes, none of them new in the database
├── quickstart.md        # Phase 1 — how to prove each slice works
├── contracts/
│   └── map.md           # Phase 1 — the endpoints this feature reads, and the guarantee
├── checklists/
│   └── requirements.md  # written by /speckit-specify
└── tasks.md             # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
src/
├── map/                        # NEW — everything map-shaped, dynamically imported
│   ├── engine.types.ts         #   the port
│   ├── engine.leaflet.ts       #   the only importer of 'leaflet'
│   ├── engine.fake.ts          #   the test double (lives with the port it implements)
│   ├── tiles.ts                #   tile URL + attribution, once (FR-013)
│   ├── pins.ts                 #   pure: projection, filtering, bounds
│   └── scope.ts                #   pure: zoneScope / tripScope
├── components/
│   ├── LocationPicker.tsx      # NEW — extracted from JourneySteps, used twice
│   ├── Layout.tsx              # TOUCHED — sixth tab, and the `bleed` mode 2a needs
│   └── map/                    # NEW — the 2a arrangement, one file per element
│       ├── MapCanvas.tsx       #   full-bleed map, Suspense + offline fallback
│       ├── MapTopBar.tsx       #   floating search field + City/Trip segments
│       ├── MapLegend.tsx       #   floating category legend card
│       ├── LocateButton.tsx    #   floating locate control (US2, not in the render)
│       ├── MapSheet.tsx        #   the peeking bottom sheet: handle, chips, cards
│       ├── CategoryChips.tsx   #   the filter row inside the sheet
│       ├── PlaceCardRow.tsx    #   the horizontal card row, and a card's expanded state
│       └── MissingPlaces.tsx   #   the count line under the chips, and its list
├── pages/
│   ├── TripMap.tsx             # NEW — the screen; orchestration only
│   ├── PlaceForm.tsx           # TOUCHED — geocode-on-save
│   └── JourneySteps.tsx        # TOUCHED — now consumes LocationPicker
├── api/types.ts                # TOUCHED — CATEGORY_META gains `dot` (stock classes)
├── lib/
│   ├── geolocation.ts          # NEW — permission states as data
│   ├── nav-labels.ts           # NEW — pure
│   ├── maps.ts                 # TOUCHED — directionsUrl
│   └── analytics-events.ts     # TOUCHED — two events
├── router.tsx                  # TOUCHED — RequireMap + the route
└── tests/                      # map.test.tsx, map-flag.test.tsx, nav-labels.test.ts,
                                # pins.test.ts, scope.test.ts, geolocation.test.ts,
                                # location-picker.test.tsx

server/src/
├── lib/place-view.ts           # TOUCHED — zonePlaceListItem + the field policy
└── services/geocode.ts         # TOUCHED — resolvePlaceLocation + setGeocoder

server/tests/map-pins.test.ts   # NEW — the TripView guarantee, asserted on the wire

scripts/backfill-coords.ts      # NEW — dry-run by default, journalled, revertible
vercel.json                     # TOUCHED — one header value
vite.config.ts                  # TOUCHED only if the tile host needs a runtime-cache rule
package.json                    # TOUCHED — leaflet, @types/leaflet, backfill:coords
specs/001-japan-trip-app/contracts/api.md  # TOUCHED — the contract source of truth
```

**Structure Decision**: the repository's existing web-application layout is kept unchanged. The one addition is `src/map/`, which follows the precedent `src/export/` set in feature 003: a directory that is dynamically imported as a unit, holds its own pure logic, and can be deleted without reaching into anything else. Unlike `src/export/`, it must **not** be added to the Workbox precache — export chunks are precached so an export works offline, whereas map tiles cannot be precached at all under the tile policy (FR-014), and precaching the map code while its tiles are unavailable would only add install weight for a screen that will show its offline fallback anyway.

## Complexity Tracking

| Violation                                                                                                                                                   | Why Needed                                                                                                                                                                                                                                                                                                                                                                                   | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `bleed` mode on `Layout`, when every other page lives inside its padding                                                                                  | 2a is full-bleed: the map reaches every edge and the controls float over it. A page cannot do that inside `px-5 pt-1`, and negative margins to cancel the padding would leave the page fighting a frame it is still nominally inside. One boolean, one route.                                                                                                                                | Wrapping the map in negative margins (`-mx-5`) was the smaller diff and was rejected: it hard-codes the padding value in a second place, so changing `Layout`'s padding silently breaks the map's bleed. A prop states the intent where the padding is defined.                                                     |
| A `Record<keyof Place, 'list' \| 'omit'>` field policy in `place-view.ts`, when the existing inline object literal already enumerates its fields explicitly | The literal is explicit but silent: adding a column to `Place` leaves it valid, and the new field simply never reaches the list — or, on the next hand-edit, quietly does. `CLAUDE.md` states the rule that anything returning a place gets the `TripView` treatment, and 003 established the compile-error form of it. ~15 lines, one behaviour-preserving move, covered by existing tests. | Leaving the literal alone was considered and is genuinely simpler. It was rejected because the failure it permits is silent and privacy-shaped, which is the same argument that put the policy tables in `export-view.ts` — and having the pattern in the repo already makes the second use cheaper than the first. |

## Post-Design Constitution Re-check

Re-evaluated after Phase 1 (`research.md`, `data-model.md`, `contracts/map.md`, `quickstart.md`):

- **G1** — still no route, no service, no direct datastore import. The design added one `lib/` projection and one service function. **PASS**
- **G2** — strengthened by design: the guarantee is asserted on the endpoint's response in `server/tests/map-pins.test.ts`, and the field policy makes a new column a build failure. **PASS**
- **G3** — unaffected; no new writes. **PASS**
- **G4** — `map_opened { scope, pin_count, missing_coords }` and `map_pin_opened { category }`. Coordinates are content and are not sent. **PASS**
- **G5** — `show-map` defaults `false`, gating tab and route. **PASS**
- **G6** — the policy fails `npm run typecheck`, which is already in the test path. **PASS**
- **G7** — OSM tiles, no key, no account, no new service. **PASS**
- **G8** — formatting and lint are per-commit. **PASS**

No new violations. The single entry in Complexity Tracking stands unchanged.
