# Implementation Plan: Export the Trip

**Branch**: `claude/speckit-export-feature-003-ypz8xf` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-trip-export/spec.md`

## Summary

One server-side projection turns a trip into an export payload at one of two detail levels, and the client
writes that payload into a file. The projection is a pure module beside `trip-view.ts`, driven by an explicit
**field policy** — `Record<keyof Place, 'share' | 'full' | 'never'>` — so adding a column to `Place` is a
compile error until someone classifies it. That policy is FR-010/FR-011 and the whole safety story for the
share version; everything else in this feature is plumbing around it.

The route is `GET /api/trips/:tripId/export?detail=share|full`, mounted on the trip-scoped router, so the
membership check and the caller's `TripView` apply by construction. Rendering happens on the device behind a
dynamic import, which is what makes the file producible with no signal and keeps the ~157 KB entry bundle
where it is. PDF ships first; DOCX, XLSX and JSON are additive writers over the same payload.

Three things came out of reading the code and change the shape of the work:

1. **Assembling the payload with today's `DataStore` is 60 round trips** (tips are fetched per parent). Two
   new store methods — `listAllPlaces`, `listAllTips` — bring it to five. No migration.
2. **Vitest never type-checks** (esbuild transpiles types away), so the field-policy compile error would not
   fail `npm test`. FR-011 is unenforceable without adding a `typecheck` script to the test path.
3. **Offline needs the payload to have been fetched once.** A tiny background prefetch when the trip home
   mounts is what turns SC-004 from a hope into a guarantee.

## Technical Context

**Language/Version**: TypeScript 5.5, Node 20 (ESM), React 18.3

**Primary Dependencies**: Express 4, TanStack Query 5, React Router 6, Tailwind 3, `vite-plugin-pwa` 1.3.
New, dynamically imported and client-only: `jspdf` + `jspdf-autotable` (phase 1). DOCX/XLSX writers are
deferred to their own phase — see [research.md](./research.md) R3.

**Storage**: No new tables and **no migration**. The export reads existing rows through `DataStore`; two new
read methods are added to the interface and to both backends (`datastore.memory.ts`, `datastore.supabase.ts`).

**Testing**: Vitest, two projects in one run — `server` (node + supertest against `createApp()` with the
fixture store) and `web` (jsdom + React Testing Library). Plus a new `npm run typecheck` (`tsc --noEmit`),
which this feature makes load-bearing rather than optional.

**Target Platform**: Mobile browsers first (iOS Safari 16+, Chrome Android), installed as a PWA. Server on
Vercel Hobby as one serverless function.

**Project Type**: Web application — existing `server/` (Express) + `src/` (React) in one repository.

**Performance Goals**: Export payload assembled in ≤5 store queries. A ~120-place trip renders to PDF in
under 10 s on a mid-range phone (SC-003). Entry bundle unchanged; the PDF writer arrives as a lazy chunk.

**Constraints**: Offline-capable (SC-004). $0 infrastructure, $5 ceiling — this feature adds no
infrastructure at all. Vercel Hobby function duration is the ceiling on the payload request; five queries is
comfortably inside it. No language model anywhere (FR-006).

**Scale/Scope**: Real trip ≈ 40 places / 9 zones; design target 3× that (~120 places, ~12 stops). Two
travellers.

## Constitution Check

`.specify/memory/constitution.md` is still the unedited template — no principles have been ratified, so there
is no constitution gate to pass or fail. The binding constraints for this repository are `CLAUDE.md` and the
board's cross-cutting constraints item, and the plan is evaluated against those instead:

| Constraint | How this plan meets it |
| --- | --- |
| Routes are access-checked by construction | The export route is mounted on `tripScopedRouter()` behind `requireTripAccess`. It inherits the check; it does **not** inherit the view, so the view is applied explicitly in the service (FR-008). |
| Anything returning a place needs the `TripView` treatment | The projection takes `TripView` as its first filter, before the field policy. Stays are dropped from places, from tips hanging off a stay, and from itinerary rows pointing at one. |
| Never import a concrete datastore | The service takes `DataStore` as an argument; the route resolves it via `getDataStore()`. |
| `asyncHandler` on every route | The export handler is wrapped; errors reach `errorMiddleware` as the standard envelope. |
| Services collect all validation errors | Only one input to validate (`detail`), so a single `VALIDATION` error with a `details` array. |
| A new analytics event must be declared first | `trip_exported` is added to `AnalyticsEventProperties` before any call site (T019). All five properties are shapes — format, detail, two counts, one flag. |
| A property is never trip content | No place name, address, description or trip title reaches PostHog. The sanitizer would drop them anyway; the call site never offers them. |
| Feature flags default off | **Not flagged.** See "Complexity Tracking" below — this is a deliberate deviation from the board's blanket "every flag defaults off", justified there. |
| Migration committed ≠ deployed | Not applicable: no migration. Called out explicitly so nobody goes looking for one. |
| Free tiers only | No new service, no new infrastructure, no server-side rendering. Two npm packages, shipped in a lazy chunk. |
| $0 target | Met. The only cost is bundle bytes, addressed in research R2. |

## Project Structure

### Documentation (this feature)

```text
specs/003-trip-export/
├── plan.md              # This file
├── spec.md              # Phase -1 (/speckit-specify)
├── research.md          # Phase 0 — the eight decisions this design rests on
├── data-model.md        # Phase 1 — the export payload and the field policy
├── quickstart.md        # Phase 1 — how to run and validate the feature
├── contracts/
│   └── export-api.md    # Phase 1 — the endpoint contract
├── checklists/
│   └── requirements.md  # spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
server/src/
├── lib/
│   ├── export-view.ts          # NEW — the field policy and the pure projection
│   ├── trip-view.ts            # (read) the view this composes with
│   ├── place-view.ts           # (read) summary_line — excluded from share by policy
│   └── datastore.ts            # MODIFIED — + listAllPlaces, listAllTips
├── services/
│   └── export.ts               # NEW — gathers rows, applies view, calls the projection
├── routes/
│   └── export.ts               # NEW — GET /export?detail=, asyncHandler-wrapped
├── lib/datastore.memory.ts     # MODIFIED — the two new reads
├── lib/datastore.supabase.ts   # MODIFIED — the two new reads
└── app.ts                      # MODIFIED — exportTripRouter into tripScopedRouter()

server/tests/
├── export-view.test.ts         # NEW — table tests for the projection (the safety story)
├── export.test.ts              # NEW — supertest: both detail levels, viewer views, 404/403
└── fixture.ts                  # MODIFIED — a place with every field populated

src/
├── lib/
│   ├── export-file.ts          # NEW — filename rules + share-or-download delivery
│   └── analytics-events.ts     # MODIFIED — trip_exported declared here first
├── export/                     # NEW — the writers, all dynamically imported
│   ├── pdf.ts                  #   phase 1
│   ├── docx.ts                 #   phase 3
│   ├── xlsx.ts                 #   phase 3
│   └── json.ts                 #   phase 3
├── pages/
│   └── TripExport.tsx          # NEW — the two labelled actions and the result sheet
├── api/
│   ├── hooks.ts                # MODIFIED — useTripExport(detail)
│   └── types.ts                # MODIFIED — the payload types
└── router.tsx                  # MODIFIED — /trips/:tripId/export

src/tests/
├── export-page.test.tsx        # NEW — two actions, no toggle; restricted view; failure speaks
└── export-file.test.ts         # NEW — filename rules, share/download fallback
```

**Structure Decision**: The existing two-runtime layout is kept exactly as it is. The projection lives
server-side beside `trip-view.ts` because that is where the `Place` type is defined and therefore the only
place the field-policy compile error can fire; the writers live client-side because the file has to be
producible with no signal. `src/export/` is a new directory rather than more files in `src/lib/` so the
lazy-chunk boundary is visible in the tree — everything under it is imported dynamically, nothing under it is
imported by the entry bundle.

## Phasing

The three phases match the spec's story priorities, and each is shippable on its own.

**Phase 1 — US1, the MVP (P1).** The field policy, the projection, the two new store reads, the endpoint, the
`typecheck` script, the PDF writer, delivery, the export screen with both actions, and `trip_exported`. Ships
as: share export, as a PDF, working offline. Note that the *screen* carries both buttons from day one — "Full
copy" is wired in phase 2 — because FR-005 is about the shape of the UI, and adding the second button later
is how you end up with a toggle.

**Phase 2 — US2 (P2).** `detail=full`: descriptions, links, tips, day plan in the payload and in the PDF.
Almost entirely policy-table entries plus PDF sections; the endpoint and the screen do not change.

**Phase 3 — US3 and US4 (P3).** DOCX, XLSX and JSON writers over the unchanged payload, and a format choice
on the result sheet. Library selection for DOCX/XLSX is deliberately deferred to this phase (research R3).

## Complexity Tracking

| Deviation | Why | Alternative rejected because |
| --- | --- | --- |
| **No feature flag**, against the board's "every flag defaults off" | Export is a read-only, client-rendered action with no spend, no new table and no destructive path. A flag would mean the button is absent on first load of a new device (flags land after first paint) — a rare feature that is missing exactly when someone goes looking for it. | Flagging it costs a PostHog round trip and an absent-on-first-paint button to protect against a risk this feature does not carry. The flag exists to guard spend and destructive writes; this is neither. Reconsider if the PDF chunk turns out to break older Safari. |
| **Two new `DataStore` methods** rather than reusing per-parent reads | 60 Supabase round trips inside one Hobby invocation for a 39-place trip. Measured against the interface, not guessed: `listTips` takes a single parent. | Looping the existing methods works on the memory store (which is what tests use) and would be slow-to-broken in production — precisely the failure mode `CLAUDE.md` warns about, arriving through performance instead of a missing migration. |
| **A `typecheck` script becomes part of the test path** | FR-011's guard is a type error, and Vitest transpiles types away without checking them. Without this, the guard silently does nothing. | A runtime key-comparison test alone cannot see a field that exists only in the TS interface, so it catches accidental spreads but not the drift the requirement is actually about. Both are implemented; only the type check catches the real case. |
