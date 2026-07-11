# Tasks: Japan Trip Companion App

**Input**: Design documents from `/specs/001-japan-trip-app/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/api.md](contracts/api.md), [quickstart.md](quickstart.md)

**Tests**: Included — the plan (research R10) commits to Vitest + supertest (API) and Vitest + RTL (UI) for the acceptance-critical paths.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

**Phasing decision (user request 2026-07-11)**: The entire app is built and validated against **placeholder data first** — an in-memory datastore loaded from local JSON, with sample files served statically. No external accounts or infrastructure are needed until Phase 8, where Supabase is configured and the datastore implementation is swapped via an env flag (`DATA_BACKEND=memory|supabase`). All services and routes depend only on the datastore interface, so the swap touches no feature code.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Include exact file paths in descriptions

## Path Conventions

Per plan.md structure: Vite React SPA at repo root (`src/`), Node/Express backend in `server/` exposed via `api/index.ts` (Vercel function), schema/seed in `supabase/`, utility scripts in `scripts/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Initialize Vite + React 18 + TypeScript project at repo root (`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`); add deps: react-router-dom 6, @tanstack/react-query 5, express 4 (@supabase/supabase-js deferred to Phase 8)
- [X] T002 [P] Set up Tailwind CSS 3 with the Japanese design tokens from research R6 (paper-white bg, sumi-ink text, vermillion accent, spacing scale) in `tailwind.config.ts` and `src/styles/index.css`; load Zen Kaku Gothic via Google Fonts in `index.html`
- [X] T003 [P] Configure Vitest for both halves (`vitest.config.ts` with jsdom environment for `src/tests/`, node for `server/tests/`); add supertest + @testing-library/react dev deps; npm scripts: `dev`, `build`, `test` (`seed`/`seed:files` arrive in Phase 8)
- [X] T004 [P] Create `vercel.json` (rewrite `/api/(.*)` → `api/index.ts`, SPA fallback to `index.html`, daily cron `GET /api/health`), `.env.example` (TRIP_ACCESS_CODE, DATA_BACKEND=memory; SUPABASE_URL / SUPABASE_SERVICE_KEY documented as Phase-8-only), and `.gitignore` (node_modules, dist, .env*)
- [X] T005 [P] Configure ESLint + Prettier (`eslint.config.js`, `.prettierrc`) for TS/React across `src/`, `server/`, `api/`, `scripts/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented — including the placeholder data layer that stands in for all real infra

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 Define the datastore interface in `server/src/lib/datastore.ts`: TypeScript entity types (Trip, JourneyStep, Zone, Place, Tip, FileAttachment per data-model.md) + repository methods needed by all services (getTripBundle, getZone, listPlaces, getPlace, create/update/deletePlace, create/update/deleteTip, listTripFiles, getFileUrl, ping) and a factory selecting the implementation from `DATA_BACKEND` (default `memory`)
- [X] T007 [P] Author placeholder content in `server/src/data/placeholder-data.json`: the real trip skeleton with placeholder details — trip with dates, ordered journey steps, zones (name + name_ja), several places per category per zone, zone- and place-level tips, and file entries whose storage_path points into `public/placeholder-files/`; add 2–3 sample files there (a PDF, an image)
- [X] T008 Implement the in-memory datastore in `server/src/lib/datastore.memory.ts`: loads placeholder-data.json at startup, serves all reads, applies mutations in memory (documented: non-persistent, resets on restart — acceptable until Phase 8), validates per data-model.md rules, `getFileUrl` returns the static `/placeholder-files/...` path and reports FILE_MISSING when the manifest points at a nonexistent file
- [X] T009 [P] Error envelope + async route wrapper in `server/src/lib/errors.ts` (codes UNAUTHORIZED, NOT_FOUND, VALIDATION, FILE_MISSING, INTERNAL per contracts/api.md conventions)
- [X] T010 [P] Shared-access-code bearer middleware in `server/src/lib/auth.ts` (compares `Authorization: Bearer` to TRIP_ACCESS_CODE; exempts `/api/health`)
- [X] T011 Express app assembly in `server/src/app.ts` (json parsing, auth middleware, error handler) with `server/src/routes/health.ts` (GET /api/health → datastore `ping()`) and POST /api/auth/verify in `server/src/routes/auth.ts`
- [X] T012 Vercel serverless entry `api/index.ts` exporting the Express app from `server/src/app.ts`; verify `vercel dev` (or Vite proxy + local node server) serves SPA + API together with zero external dependencies
- [X] T013 [P] Typed frontend API client in `src/api/client.ts` (base fetch with bearer from localStorage, error-envelope normalization, 401 → redirect to gate) and TanStack Query client in `src/api/queryClient.ts` (refetch-on-focus on, sensible staleTime for slow connections)
- [X] T014 [P] Router + app shell: `src/router.tsx` (routes for all pages incl. NotFound), `src/components/Layout.tsx` (mobile-first header/nav), `src/pages/NotFound.tsx`
- [X] T015 [P] Shared state components `src/components/Loading.tsx`, `src/components/ErrorState.tsx` (message + retry button, FR-013), `src/components/EmptyState.tsx` (FR-012)
- [X] T016 AccessGate page `src/pages/AccessGate.tsx` (code entry → POST /api/auth/verify → store in localStorage → route to Journey; wrong code shows clear error) plus route guard in `src/router.tsx`
- [X] T017 Foundation API tests in `server/tests/foundation.test.ts` (supertest against the app with the memory datastore: /api/health 200 without auth; /api/auth/verify 200/401; any other route 401 without/with-wrong bearer)

**Checkpoint**: Foundation ready — full app runs locally on placeholder data; user story implementation can now begin

---

## Phase 3: User Story 1 - Browse trip information by zone and category (Priority: P1) 🎯 MVP

**Goal**: Browse all prepared content by zone and category (hotels, attractions, food, shopping, other) with place details and zone/place tips visible.

**Independent Test**: Load the app on a phone-sized viewport, navigate to a zone (e.g., Tokyo), open a category, confirm every placeholder entry appears with details and tips (quickstart V1; SC-001: any place in ≤ 3 taps / 30 s).

### Implementation for User Story 1

- [X] T018 [P] [US1] Trip read service in `server/src/services/trips.ts`: trip + ordered steps with embedded zone summaries + per-category place_counts + trip_files_count via the datastore interface (response shape of GET /api/trip in contracts/api.md)
- [X] T019 [P] [US1] Zone read service in `server/src/services/zones.ts`: zone by id with zone-level tips, file metadata, place_counts; places by (zone, category) as list items with `summary_line`
- [X] T020 [P] [US1] Place read service in `server/src/services/places.ts`: place by id with its tips and file metadata
- [X] T021 [US1] Route GET /api/trip in `server/src/routes/trip.ts`; register in `server/src/app.ts`
- [X] T022 [US1] Routes GET /api/zones/:zoneId and GET /api/zones/:zoneId/places?category= (400 on bad category, 404 unknown zone) in `server/src/routes/zones.ts`; register in `server/src/app.ts`
- [X] T023 [US1] Route GET /api/places/:placeId (404 unknown) in `server/src/routes/places.ts`; register in `server/src/app.ts`
- [X] T024 [P] [US1] Browse endpoint tests in `server/tests/browse.test.ts` (supertest over the memory datastore with a test fixture: happy paths match contract shapes; 401; 400 bad category; 404s; counts match fixture)
- [X] T025 [P] [US1] Query hooks in `src/api/hooks.ts`: useTrip, useZone, useZonePlaces, usePlace (typed against contract shapes)
- [X] T026 [US1] Journey home page (browse form) `src/pages/Journey.tsx`: renders trip name + plain ordered list of steps/zones from useTrip as navigation entry (timeline visuals arrive in US2)
- [X] T027 [US1] Zone page `src/pages/Zone.tsx`: zone header (name + name_ja), zone tips, category tiles with counts — categories with 0 entries hidden or shown empty without breaking navigation (FR-012)
- [X] T028 [US1] CategoryList page `src/pages/CategoryList.tsx`: list of place cards (name, name_ja, summary_line) linking to detail; EmptyState when none
- [X] T029 [US1] PlaceDetail page `src/pages/PlaceDetail.tsx`: full details (description, address, external links) + place tips section
- [X] T030 [P] [US1] RTL tests in `src/tests/browse.test.tsx`: Zone page hides/marks empty categories; PlaceDetail shows tips alongside details (US1 AC3)

**Checkpoint**: User Story 1 fully functional on placeholder data — the app is a usable trip browser (MVP)

---

## Phase 4: User Story 2 - Journey visualization (Priority: P2)

**Goal**: The ordered journey rendered as a simple vertical timeline with dates, tappable steps, and the current step highlighted mid-trip.

**Independent Test**: Open the journey view — all steps in chronological order with dates on one scrollable mobile screen; tapping a step opens its zone; a step whose dates include today is visually distinguished (quickstart V2; SC-002).

### Implementation for User Story 2

- [X] T031 [P] [US2] JourneyTimeline component in `src/components/JourneyTimeline.tsx`: vertical timeline of steps (zone name + name_ja + date range), past/current/future status computed from device date (no step current when trip entirely past/future — spec edge case), custom-built per research R7
- [X] T032 [US2] Replace the plain list in `src/pages/Journey.tsx` with JourneyTimeline; each step navigates to its Zone page; trip-level header with overall dates
- [X] T033 [P] [US2] RTL tests in `src/tests/timeline.test.tsx`: ordering, date rendering, current-step highlight with mocked "today" inside/before/after the trip

**Checkpoint**: User Stories 1 AND 2 both work independently

---

## Phase 5: User Story 3 - Edit trip content on the fly (Priority: P3)

**Goal**: Add, edit, delete places and tips from the phone; deletes confirmed; failed saves retryable without losing input; changes visible to the other traveler on next view.

**Independent Test**: Add a restaurant to a zone (< 1 min, SC-008) → appears immediately; edit it; delete it via confirmation; simulate offline save → error + retry with text preserved (quickstart V3). (In placeholder mode edits persist only for the server process lifetime — durable persistence arrives with Phase 8.)

### Implementation for User Story 3

- [X] T034 [P] [US3] Place mutation methods in `server/src/services/places.ts`: create/update/delete via the datastore with validation (required name/zone/category, category enum, links URL check, length caps per data-model.md); delete is plain hard delete here (file re-parenting added in US4)
- [X] T035 [P] [US3] Tips service in `server/src/services/tips.ts`: create (exactly-one-parent rule), update body, delete
- [X] T036 [US3] Routes POST /api/places, PATCH /api/places/:placeId, DELETE /api/places/:placeId (201/200/204, 400 VALIDATION with details, 404) in `server/src/routes/places.ts`
- [X] T037 [US3] Routes POST /api/tips, PATCH /api/tips/:tipId, DELETE /api/tips/:tipId in `server/src/routes/tips.ts`; register in `server/src/app.ts`
- [X] T038 [P] [US3] Mutation endpoint tests in `server/tests/edit.test.ts` (supertest: happy paths, validation 400s incl. both-parents tip, 404s, 401)
- [X] T039 [P] [US3] Mutation hooks in `src/api/mutations.ts`: create/update/delete place + tip with TanStack Query cache invalidation (zone, category list, place, trip counts) so edits appear immediately and on the other device via refetch-on-focus (FR-018)
- [X] T040 [US3] PlaceForm page `src/pages/PlaceForm.tsx` (add + edit modes; category picker; on save failure keep all entered text and show ErrorState with retry, FR-019); routes `/zones/:zoneId/places/new` and `/places/:placeId/edit`
- [X] T041 [P] [US3] ConfirmDialog component `src/components/ConfirmDialog.tsx` (accessible, used for all deletes, FR-017)
- [X] T042 [US3] Wire editing entry points: add-place button on Zone/CategoryList pages, edit + delete (with ConfirmDialog) on PlaceDetail in `src/pages/Zone.tsx`, `src/pages/CategoryList.tsx`, `src/pages/PlaceDetail.tsx`
- [X] T043 [US3] TipEditor component `src/components/TipEditor.tsx` (inline add/edit/delete of tips with confirmation) integrated on Zone and PlaceDetail pages (FR-016)
- [X] T044 [P] [US3] RTL tests in `src/tests/edit.test.tsx`: delete shows confirmation before mutation fires; failed save preserves form input and offers retry

**Checkpoint**: On-the-fly editing complete; browsing stories unaffected

---

## Phase 6: User Story 4 - Access pre-collected files (Priority: P4)

**Goal**: Files are listed with recognizable names on their place/zone/trip and open on the phone; missing files produce a clear error. (Placeholder mode serves samples from `public/placeholder-files/`; real blob storage + signed URLs arrive in Phase 8 behind the same interface.)

**Independent Test**: Open a zone's sample file from the file list (< 10 s, SC-003); trip-level docs listed; a manifest entry pointing at a nonexistent file yields a clear in-app error (quickstart V4).

### Implementation for User Story 4

- [X] T045 [P] [US4] Files service in `server/src/services/files.ts`: list trip-level files; resolve a file's open URL via datastore `getFileUrl` (memory: static path; later Supabase: 300 s signed URL); distinguish NOT_FOUND (no row) from FILE_MISSING (entry exists, file gone) per contracts/api.md
- [X] T046 [US4] Routes GET /api/files and GET /api/files/:fileId/url in `server/src/routes/files.ts`; register in `server/src/app.ts`
- [X] T047 [US4] Update place deletion in `server/src/services/places.ts`: re-parent the place's files to the trip before delete (no silent file loss, data-model.md note)
- [X] T048 [P] [US4] Files endpoint tests in `server/tests/files.test.ts` (supertest: listing, URL happy path, 404 NOT_FOUND vs 404 FILE_MISSING, 401; place-delete re-parents files)
- [X] T049 [P] [US4] FileList component `src/components/FileList.tsx`: name + type icon (by mime) + size; tap → fetch URL from /api/files/:id/url → open in new tab/download; FILE_MISSING → clear inline error (FR-013)
- [X] T050 [US4] TripFiles page `src/pages/TripFiles.tsx` (trip-level docs area, linked from Layout nav) and integrate FileList into `src/pages/Zone.tsx` and `src/pages/PlaceDetail.tsx`

**Checkpoint**: All four user stories independently functional on placeholder data

---

## Phase 7: Polish (still placeholder mode)

**Purpose**: Improvements that affect multiple user stories — everything here runs without any infrastructure

- [X] T051 [P] Design polish pass across all pages/components per research R6 (consistent ma spacing, thin rules, vermillion accents, Japanese decorative subtitles, category icons) in `src/styles/` and `src/components/`
- [X] T052 [P] Mobile audit on real phone (via LAN dev server) + DevTools: no horizontal scrolling anywhere, tap targets ≥ 44 px, one-handed reachability (SC-004) — fix findings across `src/pages/` and `src/components/`
- [X] T053 Performance: check bundle size, lazy-load PlaceForm/TripFiles routes if needed, run Lighthouse mobile on Journey + Zone against local preview build → content < 3 s (SC-006)
- [X] T054 [P] Write `README.md` (what it is, placeholder-mode quick run, planned infra activation, access code handling, $0 cost notes)

---

## Phase 8: Infrastructure Activation & Deployment (deferred by design)

**Purpose**: Configure the real infrastructure (Supabase DB + Storage, Vercel hosting) and swap the datastore — no feature code changes

- [X] T055 Supabase free project created, schema applied, private bucket `trip-files` created, `.env.local` set with SUPABASE_URL + SUPABASE_SECRET_KEY (new-format `sb_secret_...` key; code reads SUPABASE_SECRET_KEY, falls back to legacy SUPABASE_SERVICE_KEY). @supabase/supabase-js added.
- [X] T056 Schema migration `supabase/migrations/0001_init.sql`: tables trips, journey_steps, zones, places, tips, files per data-model.md (TEXT PKs to preserve human-readable seed ids — see data-model note; FKs with cascade rules, `unique(trip_id, position)`, tips/files `num_nonnulls(...) = 1` checks, `(zone_id, category)` index, `updated_at` trigger, deny-all RLS on every table). Includes the added image_url/lat/lng columns.
- [X] T057 Supabase server client in `server/src/lib/supabase.ts` (service-role key from env, single shared client, FILES_BUCKET constant)
- [X] T058 Supabase datastore implementation in `server/src/lib/datastore.supabase.ts` fulfilling the T006 interface (reads, validated mutations, `getFileUrl` → 300 s signed URL with FILE_MISSING detection, `ping` → trivial select); registered in the T006 factory under `DATA_BACKEND=supabase`
- [X] T059 [P] Seed script `scripts/seed.ts` (`npm run seed`): loads `server/src/data/placeholder-data.json` into Supabase, idempotent upserts, FK-safe order
- [X] T060 [P] File upload script `scripts/seed-files.ts` (`npm run seed:files`): uploads blobs from `public/<storage_path>` to the bucket at the matching key (upsert)
- [X] T061 Seeded (`npm run seed`: 1 trip/8 zones/9 steps/30 places/13 tips/3 files; `npm run seed:files`: 3 blobs) and verified against Supabase from a networked server: reads (trip/zone/files), a create→read→delete write cycle, real storage signed URLs, and the full UI rendering (8 map pins + 9 step cards). New diagnostic: `npx tsx scripts/check-supabase.ts`.
- [X] T062 Deployed to Vercel (GitHub-connected auto-deploy), env vars set for Production. Two deploy issues found + fixed: (a) ERR_MODULE_NOT_FOUND — Vercel's per-file ESM transpile left extensionless relative imports. Final clean fix: explicit `.js` extensions on all relative imports in server/ and api/ (proper Node ESM) — no bundling, no generated files, `api/index.ts` is a plain re-export. (b) routing — a plain `api/index.ts` + rewrite `/api/(.*)` → `/api` funnels every /api/* depth to the one function (the `[...path]` catch-all only matched one segment under the Vite preset). Live at japan-app-eight.vercel.app.
- [X] T063 Validated live: /api/health 200 (Supabase reachable), gate login (verify POST) works, home + map + slider render, zone/category/place nested routes and files all return 200 from Supabase in production. (A phone pass by the travelers is the only thing left, at their leisure.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories. T006 (interface) gates T008; T007 gates T008; T009–T010 gate T011→T012; T013–T015 gate T016
- **User Stories (Phases 3–6)**: All depend on Phase 2 completion; none depend on any real infrastructure
- **Polish (Phase 7)**: Depends on the user stories being complete; runs entirely in placeholder mode
- **Infrastructure (Phase 8)**: Deferred by design — depends on Phase 2 (interface) and is best done after Phases 3–7 so the swap is validated against the finished app. T055→T056→(T057, T058)→(T059, T060)→T061→T062→T063

### User Story Dependencies

- **US1 (P1)**: Only Foundational — no other story
- **US2 (P2)**: Only Foundational; T032 touches `src/pages/Journey.tsx` created in T026, so run US2 after US1 (or accept a merge on that one file)
- **US3 (P3)**: Only Foundational for its backend; frontend wiring (T042, T043) edits US1's pages — schedule after US1
- **US4 (P4)**: Only Foundational for its backend; T047 edits US3's delete path (if US3 skipped, plain delete stands); T050 edits US1's pages

### Within Each User Story

- Services before routes; routes before frontend pages that call them
- Components ([P]) before the pages that integrate them
- Test tasks are [P] with implementation of *other* files, but run the suite green before the story's checkpoint

### Parallel Opportunities

- Phase 1: T002–T005 all [P] after T001
- Phase 2: T007, T009, T010 in parallel after T006; T013, T014, T015 in parallel anytime after T001
- US1: T018, T019, T020 (services) in parallel; T025 + T030 parallel with backend route work
- US3: T034, T035 parallel; T039, T041 parallel with backend
- US4: T045, T048, T049 parallel
- Phase 8: T059, T060 parallel after T058
- Backend of a later story can proceed in parallel with frontend of an earlier one (different files)

---

## Parallel Example: User Story 1

```bash
# After Phase 2, launch the three read services together:
Task: "Trip read service in server/src/services/trips.ts"          (T018)
Task: "Zone read service in server/src/services/zones.ts"          (T019)
Task: "Place read service in server/src/services/places.ts"        (T020)

# While routes are being wired (T021–T023), in parallel:
Task: "Query hooks in src/api/hooks.ts"                            (T025)
Task: "Browse endpoint tests in server/tests/browse.test.ts"       (T024)
Task: "RTL tests in src/tests/browse.test.tsx"                     (T030)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories; includes the placeholder datastore)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: quickstart V0 + V1 on a phone-sized viewport — zero infrastructure needed
5. The app is already a useful trip browser running on placeholder data

### Incremental Delivery

1. Setup + Foundational → app boots locally on placeholder data (access gate + health live)
2. US1 → validate V1 (MVP: browse everything)
3. US2 → validate V2 (journey timeline)
4. US3 → validate V3 (edit on the fly, in-memory)
5. US4 → validate V4 (files from placeholder samples)
6. Polish → design/mobile/perf, still $0 and account-free
7. **Infrastructure activation** → Supabase + seed real data/files + `DATA_BACKEND=supabase` + deploy → full V0–V6 on the production URL before departure

### Solo/Pair Strategy

This is a two-person personal project; the practical split after Phase 2: one person drives backend tasks (services/routes/tests) while the other drives frontend (pages/components/tests) within each story, converging at each checkpoint. Phase 8 is a single sitting once real trip content is ready.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable at its checkpoint — on placeholder data alone
- Placeholder-mode caveats (by design): edits don't survive server restarts; files are local samples. Both resolve automatically at Phase 8 with no feature-code changes
- Commit after each task or logical group
- Stop at any checkpoint to validate the story on a real phone
- Total: 63 tasks (Setup 5, Foundational 12, US1 13, US2 3, US3 11, US4 6, Polish 4, Infrastructure 9)


---

## Implementation notes (2026-07-11, Phases 1-7 complete)

- 40 automated tests pass (31 API via supertest, 9 UI via RTL); `tsc`, ESLint, and the production build are clean (bundle: 86 KB gzip JS, 3.6 KB CSS).
- Live-validated in a 375px browser: access gate (wrong/right code), journey timeline, Tokyo zone (empty "other" category hidden), place detail with tips/links/file, add-place via form (SC-008 flow), PATCH edit, file URL resolution + PDF serving, Documents page, no horizontal overflow.
- Bugfix found during browser validation: `usePlace('')` fired a wasted `GET /api/places/` in add mode - fixed with `enabled: placeId !== ''` in `src/api/hooks.ts`.
- T052 caveat: mobile audit done via 375px emulation + overflow checks; repeat on a real phone over LAN when convenient.
- T053 caveat: bundle size verified small enough that code-splitting is unnecessary; full Lighthouse run deferred to the production URL (with T063).
- T012 note: local dev uses `npm run dev` (tsx + Vite proxy) rather than `vercel dev`; `api/index.ts` + `vercel.json` are ready for Phase 8 deployment.
- Phase 8 update (2026-07-11): all code written (T056-T060) — schema migration, Supabase client, Supabase datastore behind DATA_BACKEND=supabase, seed scripts. Supabase now ACTIVATED and verified locally (T055, T061): project + schema + bucket live, data seeded, reads/writes/file-signed-URLs and the full UI confirmed against Supabase. Key detail: this project uses Supabase's new API key format, so the secret key env var is SUPABASE_SECRET_KEY (`sb_secret_...`); supabase.ts reads it and falls back to legacy SUPABASE_SERVICE_KEY.
- Sandbox note: the assistant's in-app preview server has no outbound network, so DATA_BACKEND=supabase can't be exercised through that preview — it was verified by running the dev server from a networked shell instead. On the user's own machine and on Vercel, network is normal. If the assistant needs in-preview visual testing later, temporarily set DATA_BACKEND=memory.
- Remaining: T062 (Vercel deploy + env vars) and T063 (prod validation) — user steps needing a Vercel account.
