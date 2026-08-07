# Yuval & Luciana in Japan 日本の旅

A private, mobile-first trip companion for our Japan trip: browse hotels, attractions, food & cafes, shopping and other places by zone; see the journey as a timeline with today's stop highlighted; open collected documents; and add/edit/delete places and tips on the fly.

Built from the spec in [specs/001-japan-trip-app/](specs/001-japan-trip-app/) (spec → plan → tasks → implementation).

## Stack

- **Frontend**: React 18 + Vite + TypeScript, Tailwind CSS (Japanese-inspired design system), React Router, TanStack Query
- **Backend**: Node.js + Express — served locally via `server/dev.ts`, in production as one Vercel serverless function ([api/index.ts](api/index.ts))
- **Data**: swappable datastore behind [server/src/lib/datastore.ts](server/src/lib/datastore.ts)
  - `DATA_BACKEND=supabase` (**what production runs on**): Supabase Postgres + Storage, free tier, $0. Edits in the deployed app persist.
  - `DATA_BACKEND=memory` (the code default — local dev and tests): seed data from [server/src/data/placeholder-data.json](server/src/data/placeholder-data.json), sample files from `public/placeholder-files/`. Edits work but reset when the server restarts.

## Run it locally (memory store — no accounts, no infra)

```
npm install
npm run dev        # frontend on http://localhost:3000, API on :3001
```

Access code: whatever `TRIP_ACCESS_CODE` is in `.env.local` (default dev fallback: `japan2026`). Both travelers use the same code. Set `TRIP_GUEST_CODE` too and that second code opens the read-only guest view (below).

```
npm test           # API routes (supertest) + UI components (RTL)
npm run lint       # ESLint
npm run build      # production bundle (~157 KB gzip JS)
```

## Guest access (read-only)

Two codes, two views. `TRIP_ACCESS_CODE` is ours; `TRIP_GUEST_CODE` is the one to hand to friends who just want to look. A guest sees the whole trip — journey, cities, places, tips, schedule, shopping list, reminders, essentials — and:

- **cannot change anything.** Every add/edit/delete button is gone, and the API answers `403 FORBIDDEN` to any non-`GET` request from the guest code, so nothing gets deleted by mistake even from a stale tab.
- **never sees trip documents.** No Documents tab, no files attached to a place or city. `/api/files` is `403` for guests (reads included), and the `files` array in zone/place responses comes back empty — so passports, bookings and tickets are not just hidden, they are never sent.

Both rules live in `authMiddleware` (`server/src/lib/auth.ts`), ahead of every route. The frontend only hides buttons; it is not what enforces this.

**Already gave the shared code to friends?** Don't ask them to re-enter anything: move the code they already have to `TRIP_GUEST_CODE`, and set `TRIP_ACCESS_CODE` to a new one that only the two of you know. Their phones keep working and silently become read-only; you two re-enter the new code once. (Sessions signed in before this existed resolve their role on next load via `GET /api/auth/session`, so nobody is bounced back to the gate.)

**Switching codes on a phone:** the sign-out button in the header (next to search) drops the stored code and the cached data and returns to the gate, so you can come back in with the other code. It's how you leave the guest view for the travelers' one on a phone that's already signed in.

Leave `TRIP_GUEST_CODE` unset and there is no guest view — the app behaves exactly as before.

## Editing the trip content

- **In the app**: add/edit/delete places and tips from any screen. In the deployed app these persist (Supabase); running locally on the memory store they last until the server restarts.
- **The seed**: [server/src/data/placeholder-data.json](server/src/data/placeholder-data.json) is what the live database was built from and what local dev loads. Editing it does **not** change the deployed data — re-run `npm run seed` against Supabase for that, or just edit in the app.
- Sample files live in `public/placeholder-files/`; regenerate the PDFs with `node scripts/make-placeholder-files.mjs`.

## English map labels (optional)

The city maps (Leaflet + free CARTO tiles) label streets in Japanese by default. For English labels, get a free [MapTiler](https://cloud.maptiler.com/account/keys/) API key (no credit card) and set `VITE_MAPTILER_KEY` in `.env.local`. Small streets that OpenStreetMap hasn't tagged with an English name may still show Japanese or nothing.

## Infrastructure (Supabase — live)

**Status: activated.** The deployed app runs on Supabase (`DATA_BACKEND=supabase`
in the Vercel project), so edits made in the app persist. Local dev and the test
suite still default to the in-memory store unless you set the env vars below.

### Adding a table later

There is no migration runner: **committing a new `supabase/migrations/*.sql`
file does not apply it.** After merging a change that adds a table or column,
run that file against the live project (Supabase SQL editor, or the Supabase MCP
`apply_migration`) and seed any rows it needs — otherwise the deployed feature
fails on its first request even though every test passes locally, because tests
use the memory store. Name the file with the next number free **on `main`**.

### First-time setup (already done for this project)

1. **Create a free Supabase project.** Copy its **Project URL** and **secret API key** (`sb_secret_...`, Settings → API).
2. **Run the schema:** paste each file in [supabase/migrations/](supabase/migrations/) into the Supabase SQL editor and run them in order (0001 → 0007).
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

## Reminders & notifications

Schedule a nudge ("book the sushi place, 12 Sep 09:00 Japan time") on the
**Reminders** tab and it arrives as a phone notification at that moment, even
with the app closed. Times are stored as absolute instants, and the chip in the
form says whether the wall clock you typed means your phone's zone or Japan's —
so a reminder set from Tel Aviv for "09:00 in Japan" fires at 09:00 in Japan.

Reminders are saved with or without the setup below; they just aren't
_delivered_ until it's done. The app says so on the Reminders screen rather than
pretending.

**All four steps are account/config work — no code changes:**

1. **Persistence.** Reminders need the Supabase backend (see _Infrastructure
   activation_ above, including migration `0006_reminders.sql`). Under
   `DATA_BACKEND=memory` each serverless invocation starts with a blank store,
   so a reminder saved now is gone minutes later.
2. **VAPID keys** — the identity that signs push messages. Run `npm run push:keys`
   once and set the three printed values (`VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) in `.env.local` **and** in Vercel →
   Settings → Environment Variables. Regenerating them invalidates every device
   that already subscribed, so generate once and keep them.
3. **A scheduler** to call `POST /api/reminders/dispatch` every few minutes.
   Vercel Hobby only runs cron **once a day**, which is useless for
   minute-accurate reminders — so use one of:
   - **[cron-job.org](https://cron-job.org)** (free, 1-minute granularity): add a
     job for `https://<your-app>.vercel.app/api/reminders/dispatch?key=<CRON_SECRET>`
     every 5 minutes.
   - **Supabase pg_cron + pg_net** (free, stays in the stack you already have):
     uncomment the block at the bottom of
     [supabase/migrations/0006_reminders.sql](supabase/migrations/0006_reminders.sql),
     fill in your host and secret, and run it.

   Either way set `CRON_SECRET` (any long random string) in Vercel — the dispatch
   endpoint is the one route the access code doesn't guard, so it checks that
   secret instead. Reminders fire on the first run _after_ their time, so the
   ping interval is the worst-case delay: every 5 minutes → up to 5 minutes late.

4. **On the phone**: open the app **from the Home Screen** (iOS only allows push
   from an installed PWA, iOS 16.4+ — a Safari tab silently has no
   notifications), go to **Reminders**, tap **Turn on**, accept the permission
   prompt, then **Send a test notification** to confirm the whole chain. Do this
   on both phones — each device subscribes separately and every device gets
   every reminder.

Still $0: web push goes through Apple/Google/Mozilla's own push services, and
cron-job.org's free tier covers this comfortably.

## Notes

- The access code is a convenience lock for a private two-person app, not serious security. Don't reuse a password you care about.
- Reminders are sent at most once: the dispatcher marks one as sent as it claims it, so an overlapping run can't double-notify. The trade-off is that a push service outage means a missed nudge rather than a retry storm.
- All API data flows through the Express backend; the browser never talks to the database directly.
