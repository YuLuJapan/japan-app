# Yuval & Luciana in Japan 日本の旅

A private, mobile-first trip companion for our Japan trip: browse hotels, attractions, food & cafes, shopping and other places by zone; see the journey as a timeline with today's stop highlighted; open collected documents; and add/edit/delete places and tips on the fly.

Built from the spec in [specs/001-japan-trip-app/](specs/001-japan-trip-app/) (spec → plan → tasks → implementation).

## Stack

- **Frontend**: React 18 + Vite + TypeScript, Tailwind CSS (Japanese-inspired design system), React Router, TanStack Query
- **Backend**: Node.js + Express — served locally via `server/dev.ts`, in production as one Vercel serverless function ([api/index.ts](api/index.ts))
- **Data**: swappable datastore behind [server/src/lib/datastore.ts](server/src/lib/datastore.ts)
  - `DATA_BACKEND=memory` (**current**): placeholder data from [server/src/data/placeholder-data.json](server/src/data/placeholder-data.json), sample files from `public/placeholder-files/`. Edits work but reset when the server restarts.
  - `DATA_BACKEND=supabase` (**Phase 8, not yet configured**): Supabase Postgres + Storage, free tier, $0.

## Run it (placeholder mode — no accounts, no infra)

```
npm install
npm run dev        # frontend on http://localhost:3000, API on :3001
```

Access code: whatever `TRIP_ACCESS_CODE` is in `.env.local` (default dev fallback: `japan2026`). Both travelers use the same code.

```
npm test           # 40 tests: API routes (supertest) + UI components (RTL)
npm run lint       # ESLint
npm run build      # production bundle (~86 KB gzip JS)
```

## Editing the trip content

- **In the app**: add/edit/delete places and tips from any screen (persists until server restart while in placeholder mode).
- **The source of truth for now**: edit [server/src/data/placeholder-data.json](server/src/data/placeholder-data.json) — replace the PLACEHOLDER entries with the real plan. This same file will be seeded into Supabase in Phase 8, so curating it is not throwaway work.
- Sample files live in `public/placeholder-files/`; regenerate the PDFs with `node scripts/make-placeholder-files.mjs`.

## English map labels (optional)

The city maps (Leaflet + free CARTO tiles) label streets in Japanese by default. For English labels, get a free [MapTiler](https://cloud.maptiler.com/account/keys/) API key (no credit card) and set `VITE_MAPTILER_KEY` in `.env.local`. Small streets that OpenStreetMap hasn't tagged with an English name may still show Japanese or nothing.

## Infrastructure activation (Phase 8)

All the code is written — schema, Supabase datastore, and seed scripts. Going
live is just account setup + flipping one env var (no feature-code changes):

1. **Create a free Supabase project.** Copy its **Project URL** and **secret API key** (`sb_secret_...`, Settings → API).
2. **Run the schema:** paste [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) into the Supabase SQL editor and run it.
3. **Create a private Storage bucket** named `trip-files`.
4. **Set env** in `.env.local`:
   ```
   DATA_BACKEND=supabase
   SUPABASE_URL=...
   SUPABASE_SECRET_KEY=...
   ```
5. **Seed:** `npm run seed` (rows) then `npm run seed:files` (blobs). Re-run `npm run dev` — edits now persist across restarts.
6. **Deploy:** `vercel deploy --prod` (Hobby, $0), set the same env vars in the Vercel project. [vercel.json](vercel.json) already routes `/api/*` and runs a daily cron on `/api/health` to keep Supabase from pausing.

The database keys are server-only and never reach the browser; all data flows through the Node backend.

**Cost**: $0 — Vercel Hobby and Supabase Free are hard-capped free tiers, no credit card. Budget ceiling for the whole project: $5.

## Notes

- The access code is a convenience lock for a private two-person app, not serious security. Don't reuse a password you care about.
- All API data flows through the Express backend; the browser never talks to the database directly.
