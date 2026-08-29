# Implementation Plan: Separate pages for repeated cities

**Branch**: `claude/separate-repeated-cities-hyncd7` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-separate-repeated-cities/spec.md`

## Summary

A trip that visits a city twice shows two stops on the journey but opens one city page, pooling both stays' places, tips and counts. The fix is one change of meaning: **a zone stops being "a city on this trip" and becomes "one visit to a city on this trip"**. `resolveZoneId` stops finding-or-creating zones by name, so every stop gets its own; one new nullable column, `zones.city_key`, records which visits are the same city, so the two Tokyos can still be labelled as siblings and content can be moved between them after a rename.

Because ~40 files key on `zone_id` and none of them change shape, the blast radius is the handful of places that *create* zones or *label* them. The app has already made this exact call one level up — `services/steps.ts` says "two trips to Tokyo each get their own Tokyo" — and `lib/export-view.ts` already carries a dedup workaround that exists only because one zone is reached by two steps. That workaround gets deleted.

The existing Tokyo content is divided by a journalled, revertible script rather than a SQL migration, because it is a judgement call against live data with no undo.

## Technical Context

**Language/Version**: TypeScript 5, Node 20, React 18

**Primary Dependencies**: Express (server), Vite + React Router `createBrowserRouter` + TanStack Query (web), Tailwind. No new dependency.

**Storage**: `DataStore` interface with two backends — `memory` (seeded from `server/src/data/placeholder-data.json`, used by dev and every test) and `supabase` (Postgres + Storage, what production runs). One new migration, `0023_zone_city_key.sql`.

**Testing**: Vitest, two projects in one run — `server` (node, supertest against `createApp()` with a fixture store) and `web` (jsdom, React Testing Library). Plus `npm run typecheck`, which is part of the gate, not a nicety.

**Target Platform**: installable mobile-first PWA; Vercel Hobby serverless function for the API.

**Project Type**: web application — React SPA plus an Express API sharing one app object across two entry points.

**Performance Goals**: no new round trip on any screen. The zone page's new `visit` block rides on a response it already fetches; the journey and map get their data from the trip bundle they already load.

**Constraints**: free tiers only ($0 target). Offline-capable — an already-opened visit page must still open with no signal. No new endpoint, so no new access-check surface.

**Scale/Scope**: one trip with a repeated city (the Japan trip: 9 zones, 10 stops, 39 places, 190 itinerary items). ~14 source files touched, 1 migration, 1 script, ~6 test files.

## Constitution Check

`.specify/memory/constitution.md` is an **unfilled template** — every principle is still a `[PRINCIPLE_N_NAME]` placeholder, so there are no ratified gates to evaluate and none can be violated. The project's real, written conventions live in `CLAUDE.md`, so the plan is gated against those instead:

| CLAUDE.md rule | How this plan complies |
| --- | --- |
| Never import a concrete datastore; go through `getDataStore()` | No service or route changes how it obtains the store. The split script is the one caller that touches a backend directly, exactly as `scripts/backfill-coords.ts` already does. |
| A route under `/api/trips/:tripId` is access-checked by construction | **No new route.** The `visit` block is added to an existing response and `zone_id` is added to existing `PATCH` bodies. |
| Anything returning a place, place id, file or booking metadata needs the view treatment | Nothing new is returned. The `visit` block carries dates and zone ids for zones the caller can already see; per-visit stay counts stay hidden exactly as per-city ones are (FR-020, SC-007 tests this). |
| A write answers with the row its list renders | The move returns the place through `lib/place-view.ts`, with `summary_line`, as every other write does. |
| Services collect *all* validation errors into one array | The move's zone/`city_key`/stranded checks are collected, not thrown on the first. |
| Committing a migration is not deploying it | Called out in `quickstart.md` §Deploying, in the right order, with the failure mode named. |
| Check the highest migration number **on `main`** | Highest is `0022_itinerary_category.sql`; this is `0023`. |
| No silent file loss | Deleting a stop does not cascade into its zone's content (FR-011, R8). |
| `npm run typecheck` alongside the tests | In the gate; `Zone` and the export projection both move. |
| Free tiers only | One nullable column and one index. |

**Result: PASS**, before Phase 0 and again after Phase 1 design. No entries in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/011-separate-repeated-cities/
├── plan.md              # This file
├── spec.md              # What and why
├── research.md          # Phase 0 — the model decision and its alternatives
├── data-model.md        # Phase 1 — the zone's new meaning, city_key, the split
├── quickstart.md        # Phase 1 — how to prove it works
├── contracts/
│   └── api-delta.md     # Phase 1 — the change set for contracts/api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — /speckit-tasks, not created here
```

### Source code (repository root)

```text
supabase/migrations/
└── 0023_zone_city_key.sql              # NEW — nullable column + backfill + (trip_id, city_key) index

scripts/
└── split-visits.ts                     # NEW — dry-run/journal/--revert, modelled on backfill-coords.ts

server/src/
├── lib/
│   ├── datastore.ts                    # Zone.city_key; listZones filter by city_key
│   ├── datastore.memory.ts             # sibling lookup
│   ├── datastore.supabase.ts           # sibling lookup
│   ├── visit.ts                        # NEW — ordinal/siblings/label input; the only place the rule lives
│   └── export-view.ts                  # DELETE the `counted` dedup Set (R1)
├── services/
│   ├── steps.ts                        # resolveZoneId always creates; reject a zone_id that already has a step
│   ├── zones.ts                        # getZoneDetail returns the `visit` block
│   ├── places.ts                       # zone_id writable on PATCH + city_key/stranded validation
│   ├── tips.ts                         # zone_id writable on PATCH
│   ├── files.ts                        # zone_id writable on PATCH
│   └── search.ts                       # visit label in the subtitle
└── data/placeholder-data.json          # split by the script, committed

src/
├── lib/visit-label.ts                  # NEW — pure, table-tested; the only wording of a visit label
├── api/types.ts                        # Zone.city_key, the visit block
├── api/hooks.ts, api/mutations.ts      # the move mutation + its two-zone invalidation
├── pages/Zone.tsx                      # the label, and the move entry point
├── pages/PlaceDetail.tsx               # "Move to another visit" (only when total > 1)
├── pages/Search.tsx                    # labelled results
├── pages/JourneySteps.tsx              # the delete-a-stop warning (FR-011)
├── map/scope.ts                        # visit labels on the trip-scale chips
└── components/Breadcrumbs.tsx          # the visit, not the city

server/tests/  split-visits, steps-visits, visit-move, + export/map-pins assertions
src/tests/     visit-label, zone page label, move flow
```

**Structure Decision**: the existing two-runtime layout is unchanged — `server/src/{routes,services,lib}` behind the `DataStore` interface, `src/{pages,components,api,lib}` on the web side. This feature adds no directory and no boundary. The two genuinely new modules are `server/src/lib/visit.ts` and `src/lib/visit-label.ts`, both pure, both single-purpose, and deliberately split across the two runtimes for the same reason `lib/ordering.ts` mirrors the datastore's ordering: the server owns the ordinal (the export needs it), the client owns the wording (the screens need it), and a test runs both over the same rows so the copies cannot drift.

## Phases

- **Phase 0 — research** ✅ [`research.md`](./research.md): the model decision (R1) and its two rejected alternatives, `city_key` (R2), the split script (R4), labelling (R5), the move (R7), step deletion (R8), and why there is no feature flag (R10).
- **Phase 1 — design** ✅ [`data-model.md`](./data-model.md), [`contracts/api-delta.md`](./contracts/api-delta.md), [`quickstart.md`](./quickstart.md).
- **Phase 2 — tasks**: `/speckit-tasks`. Suggested slicing, US1+US2 first (both P1 and worthless apart), then the split script against the live data, then US3's move, then US4's labels.

## Risks

| Risk | Mitigation |
| --- | --- |
| The split runs once against live data with no undo | Dry run by default, journalled, `--revert`; run against the placeholder JSON first, where the expected output is written down in `quickstart.md` and asserted in `split-visits.test.ts` |
| Migration committed but not applied → deployed app 500s on its first zone read while all tests pass | The known failure mode from CLAUDE.md. Ordered explicitly in `quickstart.md` §Deploying: migration, then split, then deploy |
| A regression on the eight cities visited once — the case that must not change | FR-003 is structural, not a special case: `total: 1` derives an empty label, so there is nothing to render. Asserted per surface |
| A per-visit count lets a hidden stay be inferred | SC-007 and FR-020; `hideStayCounts` already applies per zone and therefore per visit. Tested on both visits, not just one |
| An orphan zone (stop deleted, content kept) crashes a page assuming a step | `visit.step_id` is nullable by design (R8); the export walks steps, so an orphan is simply absent |
