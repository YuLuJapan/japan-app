# Quickstart & Validation Guide: Japan Trip Companion App

**Date**: 2026-07-11 | **Plan**: [plan.md](plan.md) | **Contract**: [contracts/api.md](contracts/api.md) | **Data**: [data-model.md](data-model.md)

How to run the app locally, deploy it for $0, and validate every user story end-to-end.

**Two modes** (plan: "Phased data backend"): development runs entirely on **placeholder data** — no accounts, no infrastructure. Real infrastructure (Supabase + Vercel) is activated later by switching `DATA_BACKEND`.

## Prerequisites

- **Placeholder mode (start here)**: only Node.js 20+ and npm
- **Infrastructure activation (later)**: free accounts (no credit card) at [Supabase](https://supabase.com) and [Vercel](https://vercel.com) (Hobby); Vercel CLI: `npm i -g vercel`

## Run locally — placeholder mode (no infra)

1. Create `.env.local` at repo root:
   ```
   TRIP_ACCESS_CODE=…        # the shared code both travelers will use
   DATA_BACKEND=memory       # placeholder in-memory datastore (default)
   ```
2. Install and run:
   ```
   npm install
   npm run dev       # serves the Vite frontend + /api/* Express backend together
   ```
   Content comes from `server/src/data/placeholder-data.json`; sample files from `public/placeholder-files/`. Edits (US3) persist only while the server runs — durable persistence arrives with infrastructure activation.

Open http://localhost:3000 on a phone-sized viewport (DevTools mobile emulation).

Run tests:

```
npm test          # Vitest: server route tests (supertest) + frontend component tests (RTL)
```

## Infrastructure activation (deferred — tasks Phase 8)

1. **Supabase project** (free tier):
   - Create a project; note the project URL and the **secret API key** (`sb_secret_...`, Settings → API; server-only). Legacy projects: the `service_role` JWT works too.
   - Run the schema: apply `supabase/migrations/*.sql` (SQL editor or `supabase db push`). This creates all tables, check constraints, indexes, and deny-all RLS.
   - Create a **private** Storage bucket named `trip-files`.
2. **Environment** — extend `.env.local`:
   ```
   DATA_BACKEND=supabase
   SUPABASE_URL=…            # project URL
   SUPABASE_SECRET_KEY=…     # secret API key sb_secret_... (server-only, never shipped to the browser)
   ```
3. **Seed real content**:
   ```
   npm run seed          # loads the curated trip data: trip, steps, zones, places, tips
   npm run seed:files    # uploads pre-collected files to the bucket + inserts metadata rows
   ```
4. Re-run locally (`npm run dev`) and confirm the app now serves Supabase data (edits survive restarts).

## Deploy ($0 — after infrastructure activation)

```
vercel deploy --prod
```

- Set the env vars (TRIP_ACCESS_CODE, DATA_BACKEND=supabase, SUPABASE_URL, SUPABASE_SECRET_KEY) in the Vercel project settings.
- Confirm `vercel.json` registered the daily cron → `GET /api/health` (Supabase keep-alive, research R3).
- Budget check (SC-005 / FR-014): Vercel Hobby and Supabase Free are hard-capped at $0 with no card on file — spend cannot exceed $0.

## Validation scenarios

Perform on a real phone (or mobile emulation) against the deployed URL. During development, V0–V5 can be run early in placeholder mode against the local dev server (V4's missing-blob case = a manifest entry pointing at a nonexistent sample file); V6 and final sign-off require the deployed, Supabase-backed app.

### V0 — Access gate (research R8)

1. Open the app URL in a private window → access screen appears; wrong code → clear error; correct code → Journey view. API calls without the code return 401 (verify: `curl -i https://<app>/api/trip` → 401).

### V1 — Browse by zone & category (US1, FR-002/003/004/012)

1. From the Journey view tap a map pin or a step card (e.g., Tokyo) → zone view shows zone tips and only categories that have entries; empty categories hidden without breaking navigation.
2. Open Food & Cafés → list shows every seeded entry with thumbnail; open one → full details (name, description, address, links) plus its place-level tips.
3. **Pass**: any seeded place reachable in ≤ 3 taps from app open, under 30 s (SC-001); no horizontal scrolling anywhere (SC-004).

### V2 — Journey visualization (US2, FR-005/006)

1. Open the Journey (home) view → the city map shows one numbered pin per city in visit order; below it the steps appear as a horizontal slider of photo cards with dates (SC-002).
2. Tap a pin or a step card → lands on that zone's view.
3. Temporarily set a journey step's dates to include today (edit seed or DB row) → reload → that step's card is highlighted with a "Now" badge and its city pin turns coral. Restore dates; with all dates in the future → no step highlighted (edge case).

### V3 — Edit on the fly (US3, FR-015..019, SC-008)

1. From a zone, add a new restaurant (name + category + a note) using only the phone UI → appears immediately in that zone's Restaurants list; **time the flow: must be < 1 minute** (SC-008).
2. Edit its description → change visible on the detail view.
3. Open the same zone on a second device/browser → the new place is there (FR-018).
4. Delete it → confirmation dialog appears (FR-017); confirm → gone from all views.
5. Failure path: with DevTools offline, submit an edit → error + retry shown, entered text preserved (FR-019); go online, retry → saves.

### V4 — Files (US4, FR-007/008)

1. Zone with an attached file → file listed with recognizable name/type; tap → opens/downloads on the phone in < 10 s (SC-003).
2. Trip-level documents area lists trip files (US4 AC3).
3. Missing-blob case: delete one object from the bucket (leave its DB row) → tapping it shows a clear error, not a blank screen (`FILE_MISSING`, FR-013). Re-upload afterwards.

### V5 — Resilience & performance (FR-013, SC-006)

1. DevTools "Slow 3G": navigate between views → loading states appear, content shows; previously visited views render from cache instantly.
2. DevTools offline mid-navigation → clear error with retry; retry succeeds when back online.
3. Lighthouse (mobile) on Journey and a zone view → content displayed < 3 s on simulated mid-tier mobile (SC-006).

### V6 — Keep-alive & cost (FR-014, SC-005)

1. Vercel cron log shows a daily successful hit on `/api/health`.
2. After a week of deployment: Supabase project still active (not paused); Vercel + Supabase billing pages both show $0. Total project spend ≤ $5 → expected $0.

## Expected outcome

All V0–V6 pass on a phone against the production URL → the feature satisfies every user story, all functional requirements, and all success criteria in [spec.md](spec.md).
