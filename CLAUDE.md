# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A private, mobile-first trip companion for a two-person Japan trip: browse hotels/attractions/food/shopping by zone, see the journey as a timeline, open collected documents, and add/edit/delete places and tips on the fly. Built from the spec in `specs/001-japan-trip-app/` (spec → plan → tasks → implementation) using the Speckit workflow (`.specify/`, `.claude/skills/speckit-*`).

## Commands

```
npm install
npm run dev          # frontend on :3000 (Vite), API on :3001 (Express), run concurrently
npm run dev:web       # frontend only
npm run dev:api       # API only (tsx watch server/dev.ts)

npm test              # vitest run — both projects (web + server), 40+ tests
npm run test:watch    # vitest watch mode
npx vitest run server/tests/browse.test.ts        # single server test file
npx vitest run src/tests/browse.test.tsx          # single web test file
npx vitest run -t "returns the journey skeleton"  # by test name

npm run lint           # ESLint (flat config, typescript-eslint recommended)
npm run format          # prettier --write .
npm run build            # production bundle (vite build; currently ~86 KB gzip JS)
npm run preview           # serve the production build locally

npm run seed          # seed Supabase rows (only relevant once DATA_BACKEND=supabase)
npm run seed:files     # seed Supabase Storage blobs
npm run check:db        # sanity-check the Supabase connection
```

Access code for local dev: value of `TRIP_ACCESS_CODE` in `.env.local` (fallback `japan2026` if unset — see `server/src/lib/auth.ts`).

There is no separate typecheck script; `tsc` runs implicitly via Vite/vitest. Run `npx tsc --noEmit` if you need an explicit check.

## Architecture

**Two runtimes sharing one Express app.** `server/src/app.ts` assembles all routes/middleware and is imported by both entry points:
- `server/dev.ts` — local dev, listens on `API_PORT` (3001), Vite proxies `/api` to it.
- `api/index.ts` — the same app exported as a single Vercel serverless function (all `/api/*` traffic in production, routed by `vercel.json`). Relative imports here use explicit `.js` extensions because it's plain ESM run through Node's loader/Vercel's per-file transpile — keep that convention for any new file under `server/`.

**Backend layering:** `routes/` (Express handlers, thin — just call a service and shape the response) → `services/` (validation + business logic, one file per entity) → a single `DataStore` interface (`server/src/lib/datastore.ts`). Every service takes the store as an argument; **never import a concrete backend (`datastore.memory.ts` / `datastore.supabase.ts`) directly** — always go through `getDataStore()`. This is what makes the backend swappable and the services unit-testable with a fixture store.

**Swappable datastore, selected by `DATA_BACKEND` env var:**
- `memory` (default, current state) — in-memory store seeded from `server/src/data/placeholder-data.json`; edits persist only until the process restarts. This JSON is real content, not throwaway fixture data — it's the source of truth for trip content today and will be seeded into Supabase later, so edit it directly when updating trip info (or edit through the running app).
- `supabase` — Postgres + Storage, not yet activated. Schema lives in `supabase/migrations/*.sql` (numbered, sequential — add a new file rather than editing old ones). Activating it is pure config (env vars + running the SQL + `npm run seed`), no application code changes — see README.md "Infrastructure activation" for the exact steps if asked to do this.

Tests override the store via `setDataStore()` (see `server/tests/fixture.ts` and the `beforeEach` in any `server/tests/*.test.ts`) rather than touching env vars.

**Auth:** one shared bearer access code (`TRIP_ACCESS_CODE`) for both travelers — not per-user auth. `authMiddleware` (`server/src/lib/auth.ts`) exempts only `/api/health` and `/api/auth/verify`. Frontend stores the code in `localStorage` (`src/api/client.ts`); a 401 anywhere clears it and redirects to `/gate`. This is a convenience lock, not real security (documented in README) — don't add stronger auth machinery unless asked.

**Error handling contract** (`server/src/lib/errors.ts`, documented in `specs/001-japan-trip-app/contracts/api.md`): all errors are thrown as `ApiError(status, code, message, details?)` from services/routes and caught by `errorMiddleware`, producing `{"error":{"code","message"[,"details"]}}`. Route handlers are wrapped in `asyncHandler` so thrown/rejected errors reach that middleware — every new route needs this wrapper. Codes: `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION` (400, with a `details: string[]`), `FILE_MISSING`, `INTERNAL`.

**Frontend data flow:** `src/api/client.ts` (typed fetch wrapper, adds bearer header, normalizes the error envelope into `ApiError`, handles 401) → `src/api/hooks.ts` (one `useQuery`/mutation hook per API call, TanStack Query) → pages/components. Routing is a flat `createBrowserRouter` table in `src/router.tsx` gated by a `RequireAccess` wrapper that redirects to `/gate` when no access code is stored.

**API contract source of truth:** `specs/001-japan-trip-app/contracts/api.md`. When adding/changing an endpoint, update this file too — it's not just historical documentation, it's referenced by both frontend and backend code comments.

## Conventions worth knowing

- No semicolons, single quotes, 100-char print width (`.prettierrc`); run `npm run format` rather than hand-wrapping lines.
- ESLint flags unused vars/params as errors except when prefixed `_`.
- Services validate input and collect *all* validation errors into one array (see `collectPlaceErrors` pattern in `server/src/services/places.ts`) rather than throwing on the first bad field — mirror this pattern for new entities.
- `Partial<...>Input` + a `partial: boolean` flag is the standard shape for validating both POST (full) and PATCH (partial) bodies with one function.
- Deleting a place reparents its files to the trip first (`reparentFilesToTrip`) — "no silent file loss" is a deliberate product rule, not an oversight; keep that in mind for any other delete-cascade logic.
- Vitest is configured as two projects in one run (`vitest.config.ts`): `web` (jsdom, `src/tests/**/*.test.tsx`) and `server` (node, `server/tests/**/*.test.ts`). Server tests use `supertest` against `createApp()` with a fixture datastore; web tests use React Testing Library with helpers in `src/tests/helpers.tsx`.
- Design system: Tailwind tokens in `tailwind.config.ts` (`canvas`/`ink`/`muted`/`line`/`brand`/`sun`/`ocean`, `Plus Jakarta Sans` font, capped `max-w-app` mobile-first container) — reuse these tokens rather than introducing new ad-hoc colors.
- Budget/infra constraint baked into product decisions: everything must fit free tiers (Vercel Hobby + Supabase Free, $0 target, $5 hard ceiling) — don't suggest paid services or infra.
