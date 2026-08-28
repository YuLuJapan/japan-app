# Implementation Plan: Japan Trip Companion App

**Branch**: `001-japan-trip-app` | **Date**: 2026-07-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-japan-trip-app/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

A private, mobile-first web app that is the single source of truth for a two-person Japan trip: browse hotels, attractions, restaurants & cafes, shopping and other places organized by zone; see the journey as a simple vertical timeline with the current step highlighted; open pre-collected files; and add/edit/delete places and tips on the fly during the trip.

Technical approach (from [research.md](research.md)): React 18 + Vite + Tailwind SPA with a Japanese-inspired custom design system, served with a Node.js (Express) backend as a single Vercel serverless function, backed by Supabase Free (Postgres for structured data, Storage with signed URLs for files). Shared-access-code auth, last-write-wins editing, TanStack Query for caching/retry/refetch-on-focus. Total infrastructure cost: **$0** (budget ceiling $5, FR-014).

**Phased data backend (user decision 2026-07-11)**: all features are built first against a placeholder **in-memory datastore** loaded from local JSON (sample files served statically) — no external accounts or infrastructure needed during development. Services depend on a datastore interface (`server/src/lib/datastore.ts`); the Supabase implementation is added in a final infrastructure-activation phase and selected via `DATA_BACKEND=memory|supabase`, with no feature-code changes.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 (backend), TypeScript 5.x + React 18 (frontend)

**Primary Dependencies**: Express 4 (API), @supabase/supabase-js 2 (DB + Storage client, server-side only), Vite 5, Tailwind CSS 3, React Router 6, TanStack Query 5

**Storage**: Phase-dependent behind a common datastore interface — development: in-memory store from `server/src/data/placeholder-data.json` + static sample files; production (infrastructure phase): Supabase Free — Postgres 500 MB (trip/steps/zones/places/tips/file metadata) + Supabase Storage 1 GB private bucket (pre-collected files, served via short-lived signed URLs)

**Testing**: Vitest (both halves); supertest for API route tests; React Testing Library for UI components

**Target Platform**: Mobile browsers first (iOS Safari / Android Chrome), scaling up to tablet/desktop; hosted on Vercel Hobby (static assets + one Node serverless function)

**Project Type**: Web application (frontend + backend)

**Performance Goals**: Main browsing views show content < 3 s on a typical mobile connection (SC-006); place found in ≤ 3 taps / 30 s (SC-001); files open < 10 s (SC-003); API p95 < 500 ms warm, worst-case cold start ≤ 2 s

**Constraints**: Total cost ≤ $5 → everything on hard-capped free tiers, no credit card (FR-014); tolerant of slow/intermittent connections (cached content stays viewable, failed saves retryable without data loss); usable one-handed on small phone screens, no horizontal scrolling (SC-004); Supabase free-project pausing mitigated by daily Vercel cron keep-alive

**Scale/Scope**: 2 users; 1 trip, ~5–10 zones, ~50–150 places, ~50 tips, a few hundred MB of files; ~8 screens (access gate, journey/home, zone, category list, place detail, place/tip edit forms, trip files, not-found)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

`.specify/memory/constitution.md` is an unfilled template — no project principles have been ratified. No gates to enforce. **PASS (vacuous)**.

General simplicity principles applied in its absence: two-part web app is the minimum matching the explicit frontend/backend requirement; no extra projects, no repository-pattern indirection (thin service layer over supabase-js), no real-time infrastructure, no component/chart libraries where ~100 lines of owned code suffices.

**Post-Phase-1 re-check (2026-07-11)**: design artifacts introduce no additional projects or patterns beyond the above. **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/001-japan-trip-app/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── api.md           # REST API contract (Phase 1 output)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
api/
└── index.ts             # Vercel serverless entry — exports the Express app

server/
├── src/
│   ├── app.ts           # Express app assembly (routes + middleware)
│   ├── data/
│   │   └── placeholder-data.json  # placeholder trip content (dev backend)
│   ├── lib/
│   │   ├── datastore.ts          # datastore interface + DATA_BACKEND factory
│   │   ├── datastore.memory.ts   # placeholder in-memory implementation (dev)
│   │   ├── datastore.supabase.ts # Supabase implementation (infra phase)
│   │   ├── supabase.ts  # Supabase server client (service-role key, infra phase)
│   │   ├── auth.ts      # shared-access-code bearer middleware
│   │   └── errors.ts    # error envelope + async handler
│   ├── routes/
│   │   ├── trip.ts      # GET /api/trip (trip + steps + zones summary)
│   │   ├── zones.ts     # GET /api/zones/:id, GET /api/zones/:id/places
│   │   ├── places.ts    # GET/POST/PATCH/DELETE /api/places[...]
│   │   ├── tips.ts      # POST/PATCH/DELETE /api/tips[...]
│   │   ├── files.ts     # GET /api/files, GET /api/files/:id/url
│   │   └── health.ts    # GET /api/health (keep-alive cron target)
│   └── services/        # per-entity logic over the datastore interface
└── tests/               # supertest route tests (mocked data layer)

src/                     # React frontend (Vite root)
├── main.tsx, App.tsx, router.tsx
├── api/                 # typed API client + TanStack Query hooks
├── components/          # timeline, place card, tip list, file list,
│                        # confirm dialog, empty/loading/error states
├── pages/               # AccessGate, Journey (home), Zone, CategoryList,
│                        # PlaceDetail, PlaceForm, TripFiles, NotFound
├── styles/              # Tailwind config helpers, design tokens
└── tests/               # RTL component tests

supabase/
├── migrations/          # schema SQL (tables, RLS deny-all, indexes)
└── seed/                # seed data (JSON/SQL) + file-upload script

public/                  # static assets (icons, fonts)
└── placeholder-files/   # sample docs/images served in dev (placeholder mode)
vercel.json              # rewrites /api/* → api/index.ts, daily cron → /api/health
package.json             # single package; scripts for dev/test/build
```

**Structure Decision**: Single package, two halves. The Vite SPA lives at the repo root (`src/`), the Node backend in `server/` exposed through the one Vercel function in `api/` — the standard Vercel SPA + API layout, avoiding monorepo tooling for a two-person app. All services talk to the `datastore.ts` interface so the placeholder (memory) and Supabase backends are interchangeable via env. `supabase/` holds schema and seed so all content is reproducible once infrastructure is activated.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No constitution violations — table not applicable.
