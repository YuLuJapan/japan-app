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

npm test              # vitest run — both projects (web + server), 169 tests
npm run test:watch    # vitest watch mode
npx vitest run server/tests/browse.test.ts        # single server test file
npx vitest run src/tests/browse.test.tsx          # single web test file
npx vitest run -t "returns the journey skeleton"  # by test name

npm run lint           # ESLint (flat config, typescript-eslint recommended)
npm run format          # prettier --write .
npm run build            # production bundle (vite build; currently ~157 KB gzip JS)
npm run preview           # serve the production build locally

npm run push:keys     # generate the VAPID key pair for web push (run once, see README)
npm run seed          # seed Supabase rows (only relevant once DATA_BACKEND=supabase)
npm run seed:files     # seed Supabase Storage blobs
npm run check:db        # sanity-check the Supabase connection
```

Signing in locally needs Supabase Auth configured (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_*` — see `.env.example`). There is no shared access code any more; without those vars the gate has no working button.

There is no separate typecheck script; `tsc` runs implicitly via Vite/vitest. Run `npx tsc --noEmit` if you need an explicit check.

## Architecture

**Two runtimes sharing one Express app.** `server/src/app.ts` assembles all routes/middleware and is imported by both entry points:

- `server/dev.ts` — local dev, listens on `API_PORT` (3001), Vite proxies `/api` to it.
- `api/index.ts` — the same app exported as a single Vercel serverless function (all `/api/*` traffic in production, routed by `vercel.json`). Relative imports here use explicit `.js` extensions because it's plain ESM run through Node's loader/Vercel's per-file transpile — keep that convention for any new file under `server/`.

**Backend layering:** `routes/` (Express handlers, thin — just call a service and shape the response) → `services/` (validation + business logic, one file per entity) → a single `DataStore` interface (`server/src/lib/datastore.ts`). Every service takes the store as an argument; **never import a concrete backend (`datastore.memory.ts` / `datastore.supabase.ts`) directly** — always go through `getDataStore()`. This is what makes the backend swappable and the services unit-testable with a fixture store.

**Swappable datastore, selected by `DATA_BACKEND` env var:**

- `memory` (the code default, and what local dev + tests use unless you set the env var) — in-memory store seeded from `server/src/data/placeholder-data.json`; edits persist only until the process restarts. This JSON is real content, not throwaway fixture data — it's the seed the deployed database was built from, so edit it directly when updating trip info (or edit through the running app).
- `supabase` — Postgres + Storage. **This is what production runs on** (`DATA_BACKEND=supabase` is set in the Vercel project), so edits made in the deployed app persist. Schema lives in `supabase/migrations/*.sql` (numbered, sequential — add a new file rather than editing old ones).

> **Adding an entity? Committing the migration is not deploying it.** The Supabase project is live and has no migration runner — a new `supabase/migrations/*.sql` file does nothing until someone runs it against the project (Supabase SQL editor, or the Supabase MCP `apply_migration`). Ship a new table without that step and the deployed feature 500s on its very first request while every test still passes, because tests use the memory store. Seed rows for the new table too (`npm run seed` covers the tables listed in `scripts/seed.ts`). Also check the highest migration number **on `main`** before naming yours — parallel branches otherwise both claim the same number.

Tests override the store via `setDataStore()` (see `server/tests/fixture.ts` and the `beforeEach` in any `server/tests/*.test.ts`) rather than touching env vars.

**Reminders & web push:** `Reminder` rows carry an absolute `remind_at` instant; nothing in the app polls them. An _external_ scheduler (cron-job.org or Supabase pg_cron — Vercel Hobby cron only fires daily) calls `POST /api/reminders/dispatch`, which claims due reminders (stamping `sent_at` in the same store operation, so overlapping runs can't double-send) and pushes them to the devices of that reminder's **own trip's members** (`push_subscriptions.user_id` → `listPushSubscriptionsForUsers`; there is deliberately no unscoped list). That dispatch route is the only one exempt from `authMiddleware` besides `/api/health` — it has no signed-in caller, so it checks `CRON_SECRET` itself and refuses everything when none is configured. Push is entirely optional at runtime: with no `VAPID_*` env vars the API reports `public_key: null` and the UI explains that reminders won't be delivered, rather than failing. The browser half lives in `src/lib/push.ts` + `public/push-sw.js` (folded into the generated service worker via `workbox.importScripts`). Setup steps are in README "Reminders & notifications".

**Analytics (PostHog):** optional at runtime, exactly like push — with no `VITE_POSTHOG_PROJECT_TOKEN` (or its `VITE_POSTHOG_KEY` alias) the `capture`/`identify`/`reset` helpers in `src/lib/posthog.ts` are no-ops, `PostHogProvider` is not mounted at all (`src/main.tsx`), and nothing is sent. **Never call `posthog.capture` directly**: go through those helpers, or an unconfigured build calls into an uninitialised client. Two config choices are load-bearing and shouldn't be "tidied away": `defaults: '2026-05-30'` is what makes `capture_pageview` mean `'history_change'` — without it a `createBrowserRouter` SPA reports one `$pageview` per cold start and nothing for the navigation after it; and `autocapture: false` is a privacy decision, not a performance one — autocapture ships the _text_ of whatever was clicked, which here is trip content (a hotel's reservation details, and the shopping list, where an item **is** the secret). Session recording is off for the same reason. Events are named and carry shapes/ids only — **a new event must never put trip content in its properties**. `SessionProvider` identifies by the Supabase user id (`src/lib/session.tsx`) and `SignOutButton` calls `reset()`, so the next person on a shared device isn't attributed to the last.

**Terms & privacy:** `/terms` and `/privacy` (`src/pages/Legal.tsx`) are mounted **outside** `RequireAccess` — someone deciding whether to sign up has to read them first. Agreement is an explicit step _after_ sign-in (`components/TermsGate.tsx`), not a tick-box on the sign-up form: Google and the magic link both leave the page and come back, so a checkbox there would cover one of three ways in, and would miss accounts that predate the terms. Acceptance is stored on `profiles` (`accepted_terms_at` + `accepted_terms_version`, migration **0021 — must be applied to the live project**). **The version is what makes it work**: bump `CURRENT_TERMS_VERSION` (`server/src/lib/terms.ts`) when the documents change materially and everyone is asked again on their next visit. The client never sends a version — the server stamps its own, so nobody can accept text they weren't shown — and `syncProfile` must never touch those columns, or signing in would silently re-accept. Nothing is backfilled: recording consent nobody gave is worse than asking twice. `src/lib/legal.ts` holds the publisher and contact address in one place; it is also the only route to account deletion, since there is no in-app button.

**Auth:** per-user accounts (Supabase Auth JWTs), then per-trip membership. The two are deliberately separate modules:

- `lib/identity.ts` — _who_. Verifies the bearer token into an `AuthUser`, caches the result 60s (failures 10s), and says nothing about permissions. `setTokenVerifier` is the test seam, the same idiom as `setDataStore`.
- `lib/auth.ts` — the door. `authMiddleware` sets `req.user` and `req.access` (the caller's memberships) and makes no content decisions. Exempt: `/api/health` and `/api/reminders/dispatch`.
- `lib/trip-context.ts` — the choke point. Every content route is mounted under `/api/trips/:tripId` behind `requireTripAccess`, which resolves the `trip_members` row into a `TripContext` (`trip`, `role`, `view`). **A route added to that router is access-checked by construction**, reads included — this is the property to preserve.

The shared access codes are gone (phase 6b). A code proved a right rather than naming a person, so no per-trip rule could constrain it: the owner code reached every trip in the database. Anything reintroducing a non-account caller reintroduces that.

**Trip flight & start time:** `trips.flight` is jsonb (migration 0017) whose shape is enforced in exactly one place, `server/src/lib/flight.ts` — a hand-edited row must not reach the countdown as a half-object. Everything but `legs` is optional; **extra legs _are_ a connection**, which is why nothing models one separately. Times are stored and validated **in pairs** (`depart_at` + `depart_tz`, `start_time` + `start_tz`): an instant without its zone renders in whichever zone the reader's phone is in, so a countdown would jump on landing. `start_time`/`start_tz` (migration **0020 — must be applied to the live project**) let the countdown target the real start of a trip; unset, it falls back to 09:00 on `start_date`, which is what it always did. `start_date` stays a `date` deliberately — every range rule compares against it. On the client, `src/lib/flight-time.ts` converts between the form's date+time+zone and the stored instant (offsets are read _at that date_, so DST is handled), and `src/lib/flight-draft.ts` holds the pure form↔wire rules. **Omitting `flight` from a PATCH leaves it alone; `null` clears it** — the trip sheet relies on that, because the booking arrives on the bundle after the sheet opens.

**Roles decide verbs, four flags decide content.** `owner` > `partner` > `viewer` in `lib/permissions.ts` (pure, table-tested). Writes are refused once, in `requireTripAccess`, for any role that can't write — the sole exception being a member removing _themselves_. A trip that isn't yours answers **404, never 403**; a member who merely lacks the verb gets 403, since they already know it exists.

Content is `lib/trip-view.ts`: `can_see_stays` / `can_see_flight` / `can_see_documents` / `can_see_shopping` on the member row collapse into one `TripView` on the context. Writers always get the full view — the flags are _ignored_, not validated, so an owner can't lock themselves out. A `hotel` place carries the reservation in free-text description and links, so the whole category is withheld rather than redacted; the `flight` block is the same story in structured form; the shopping list is withheld wholesale because an item on it _is_ the secret (the presents). Enforcement points: place detail (403 on a hidden stay), zone detail and its counts, zone place lists, the trip bundle's `flight`, search, files, the whole `/shopping` subtree (one guard mounted on the path in `routes/shopping.ts`, so a route added there inherits it), and the itinerary (a hidden stay's `place_id` is nulled so the day plan doesn't link into a 403). **Anything new that returns a place, a place id, a file, a shopping item or trip-level booking metadata needs the same treatment** — a new route inherits the access check, not the view.

The frontend mirrors both — `useCanEdit()` / `useTripShows()` (`src/lib/session.tsx`, fed by `my_role` and `shows` on the trip bundle) and a `RequireOwner` route guard — purely so nobody is offered a button that would fail, or shown an empty list where the honest answer is "not shared with you". None of it is load-bearing.

**Error handling contract** (`server/src/lib/errors.ts`, documented in `specs/001-japan-trip-app/contracts/api.md`): all errors are thrown as `ApiError(status, code, message, details?)` from services/routes and caught by `errorMiddleware`, producing `{"error":{"code","message"[,"details"]}}`. Route handlers are wrapped in `asyncHandler` so thrown/rejected errors reach that middleware — every new route needs this wrapper. Codes: `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION` (400, with a `details: string[]`), `FILE_MISSING`, `INTERNAL`.

**Frontend data flow:** `src/api/client.ts` (typed fetch wrapper, adds bearer header, normalizes the error envelope into `ApiError`, handles 401) → `src/api/hooks.ts` (one `useQuery`/mutation hook per API call, TanStack Query) → pages/components. Routing is a flat `createBrowserRouter` table in `src/router.tsx` gated by a `RequireAccess` wrapper that redirects to `/gate` when no session token is stored.

**API contract source of truth:** `specs/001-japan-trip-app/contracts/api.md`. When adding/changing an endpoint, update this file too — it's not just historical documentation, it's referenced by both frontend and backend code comments.

## Conventions worth knowing

- No semicolons, single quotes, 100-char print width (`.prettierrc`); run `npm run format` rather than hand-wrapping lines.
- ESLint flags unused vars/params as errors except when prefixed `_`.
- Services validate input and collect _all_ validation errors into one array (see `collectPlaceErrors` pattern in `server/src/services/places.ts`) rather than throwing on the first bad field — mirror this pattern for new entities.
- `Partial<...>Input` + a `partial: boolean` flag is the standard shape for validating both POST (full) and PATCH (partial) bodies with one function.
- Deleting a place reparents its files to the trip first (`reparentFilesToTrip`) — "no silent file loss" is a deliberate product rule, not an oversight; keep that in mind for any other delete-cascade logic.
- Vitest is configured as two projects in one run (`vitest.config.ts`): `web` (jsdom, `src/tests/**/*.test.tsx`) and `server` (node, `server/tests/**/*.test.ts`). Server tests use `supertest` against `createApp()` with a fixture datastore; web tests use React Testing Library with helpers in `src/tests/helpers.tsx`.
- Design system: Tailwind tokens in `tailwind.config.ts` (`canvas`/`ink`/`muted`/`line`/`brand`/`sun`/`ocean`, `Plus Jakarta Sans` font, capped `max-w-app` mobile-first container) — reuse these tokens rather than introducing new ad-hoc colors.
- Budget/infra constraint baked into product decisions: everything must fit free tiers (Vercel Hobby + Supabase Free, $0 target, $5 hard ceiling) — don't suggest paid services or infra.
