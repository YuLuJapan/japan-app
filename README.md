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

Sign in with a Google account or an email + password — see **Accounts** below for the Supabase env vars that make it possible. Without them there is no way into a local instance, by design: the shared access code that used to be the fallback is gone.

```
npm test           # API routes (supertest) + UI components (RTL)
npm run lint       # ESLint
npm run build      # production bundle (~157 KB gzip JS)
```

`npm test` needs Docker running — it boots a real Supabase stack in containers
rather than a stand-in. See **Testing** below.

## Run it locally against a real Supabase stack

The memory store above is enough for most work and needs no Docker. Use this
when the answer depends on Postgres, PostgREST, Storage or Auth actually being
there — which is everything the deployed app does.

```
npm run dev:local    # start the stack, migrate, seed, then run the API + client
```

That brings up the same five services a hosted project runs (Postgres,
PostgREST, GoTrue, Storage, and an nginx gateway presenting them on one origin
at `http://localhost:54321`), applies every file in `supabase/migrations/`,
loads `server/src/data/placeholder-data.json`, uploads the document blobs, and
creates an account that owns the seeded trips:

```
dev@example.com / devpassword        (override with LOCAL_DEV_EMAIL / LOCAL_DEV_PASSWORD)
```

No `.env.local` edits are needed — the script passes the stack's URL and keys
to both halves of the app. The other commands:

```
npm run local:up      start + migrate + seed, without running the app
npm run local:down    stop it; the data survives
npm run local:reset   throw the data away and start again
```

Postgres is on `localhost:54322` (`postgres://postgres:postgres@localhost:54322/postgres`)
if you want to poke at it with `psql`. Every credential in `local/` is a fixed
local-only constant on a private docker network; none of it reaches a real
project.

## Testing

```
npm test                                    # everything
npx vitest run --project server             # API only
npx vitest run server/tests/browse.test.ts  # one file
```

**There are no mocks of this app's own code.** The suite boots the Supabase
stack once per run with testcontainers and points the app at it through the
normal `DATA_BACKEND=supabase` path, so routes talk to a real PostgREST, files
go to real Storage, and every bearer token is one a real GoTrue issued in
exchange for a real password. The database is truncated and reseeded before
each test (`server/testing/setup.ts`), which is why test files run serially.

Things the app fetches from the internet — exchange rates, Wikimedia photo
search, a shop's product page, translation — are served by a real local HTTP
server (`server/testing/external-web.ts`) rather than by replacing `fetch`.
Replacing it was never only a stand-in for the web: supabase-js reaches for the
same global.

Iterating is faster against a stack you already have up:

```
npm run local:up
TEST_SUPABASE_URL=http://localhost:54321 npx vitest run --project server
```

Note that this runs the tests against your local stack's database, truncating
it between tests — re-run `npm run local:reset` afterwards to get the seed
content back.

## Sharing a trip (read-only, and finer)

Invite a friend from **Who's on this trip** and pick what they get. Add their email and the invitation is simply _there_ when they next sign in — nothing to send. Leave the email blank and you get a link to share instead.

- **Viewer** — reads everything you let them, changes nothing. Every add/edit/delete button is gone, and the API answers `403` to any write, so nothing is lost from a stale tab.
- **Partner** — edits alongside you, and can invite further viewers but not another partner.

For a viewer, three independent switches decide the _content_:

- **Where we're staying.** A hotel entry _is_ the reservation — what was paid, whether it's confirmed, the cancellation terms, the Booking.com link — so the whole "Stays" category is withheld rather than scrubbed. The reservation lives in free-form text either of you can retype tomorrow, and no filter survives that. If you do want a friend to see where you're sleeping, move the booking details out of the descriptions first.
- **Flights.** The countdown still shows the days left, without the booking reference, ticket numbers or times.
- **Documents.** The Documents tab, and files attached to a place or city. A file attached to a _hotel_ follows the stays; one attached to the trip is a blob with a name the app cannot look inside, so it is governed by this switch alone.

All of it is withheld server-side — never sent, not merely hidden. Writes are refused in one place (`requireTripAccess`, `server/src/lib/trip-context.ts`); content is decided by the member's row and applied in the services that could surface it (`server/src/lib/trip-view.ts`). The frontend only hides buttons and softens the empty screens.

An invitation addressed to an email is claimed by matching the account's **confirmed** sign-in address — anyone can type someone else's email at sign-up, so an unconfirmed one is shown nothing and told to check its inbox. Declining is its own state: your invitations list says "declined" rather than dropping the row, so you know which of the two happened.

**Signing out**: the button in the header (next to search) drops the session and the cached data and returns to the gate.

**Used to have the shared codes?** They're gone. Both travellers sign in with their own account; anyone who had the guest code gets invited as a viewer instead, which is strictly more control than that code ever gave.

## Accounts

Anyone can register — Google, or email + password — and each account sees only the trips it belongs to. A brand-new account lands on an empty trips list and can create its own; it reaches nothing of anyone else's.

- **Access is per trip**, in the `trip_members` table: `owner` > `partner` > `viewer`. Creating a trip makes you its owner. There is no allow-list any more (the old `TRIP_OWNER_EMAILS` var is ignored).
- **A trip that isn't yours answers `404`, not `403`** — a 403 would confirm it exists to someone with no business knowing that. A member who merely lacks the verb gets a 403, because they already know.
- **There is no non-account way in.** The shared codes are gone: a code proves a right rather than naming a person, so no per-trip membership can constrain one — the owner code reached every trip in the database. Delete `TRIP_ACCESS_CODE` and `TRIP_GUEST_CODE` from any deployment that still sets them.
- **Setup**: needs `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (server) and `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (frontend, same project — the publishable key is safe to ship to the browser). See `.env.example`. This works independent of `DATA_BACKEND`: Supabase Auth is a property of the Supabase project, not of which datastore the app reads trip data from. The project's Auth → URL Configuration also needs the app's URL(s) on the redirect allow-list.
- **Google** needs the provider enabled in Supabase → Authentication → Providers → Google. With it off, the button is disabled. **Apple ID** is still disabled — it needs an Apple Developer account.
- Verification happens server-side in `server/src/lib/identity.ts`: the bearer token is verified as a Supabase JWT and cached for 60 seconds (failures for 10), so a warm serverless function doesn't pay a round-trip per request.

## Editing the trip content

- **In the app**: add/edit/delete places and tips from any screen. In the deployed app these persist (Supabase); running locally on the memory store they last until the server restarts.
- **The seed**: [server/src/data/placeholder-data.json](server/src/data/placeholder-data.json) is what the live database was built from and what local dev loads. Editing it does **not** change the deployed data — re-run `npm run seed` against Supabase for that, or just edit in the app.
- Sample files live in `public/placeholder-files/`; regenerate the PDFs with `node scripts/make-placeholder-files.mjs`.

## Infrastructure (Supabase — live)

**Status: activated.** The deployed app runs on Supabase (`DATA_BACKEND=supabase`
in the Vercel project), so edits made in the app persist. Plain `npm run dev`
still defaults to the in-memory store; `npm run dev:local` and the test suite
run against a real stack in containers (see above).

### Adding a table later

There is no migration runner: **committing a new `supabase/migrations/*.sql`
file does not apply it.** After merging a change that adds a table or column,
run that file against the live project (Supabase SQL editor, or the Supabase MCP
`apply_migration`) and seed any rows it needs — otherwise the deployed feature
fails on its first request. Name the file with the next number free **on `main`**.

The tests do apply every migration, to a throwaway database, so a migration
that does not run — or that disagrees with the code — now fails the suite
rather than waiting to fail in production. What the suite still cannot know is
whether anyone ran it against the live project.

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

   **`CRON_SECRET` (any long random string) is required** in Vercel: the dispatch
   endpoint is the one route with no signed-in caller to authenticate, so it
   checks that secret instead — and with none configured it refuses every call
   rather than standing open. Reminders fire on the first run _after_ their
   time, so the ping interval is the worst-case delay: every 5 minutes → up to
   5 minutes late.

4. **On the phone**: open the app **from the Home Screen** (iOS only allows push
   from an installed PWA, iOS 16.4+ — a Safari tab silently has no
   notifications), go to **Reminders**, tap **Turn on**, accept the permission
   prompt, then **Send a test notification** to confirm the whole chain. Do this
   on both phones — each device subscribes separately, against whichever
   account is signed in on it, and receives the reminders of every trip that
   account is on.

Still $0: web push goes through Apple/Google/Mozilla's own push services, and
cron-job.org's free tier covers this comfortably.

## Analytics (PostHog — optional)

Off by default. The app runs, builds and tests identically with no PostHog
configuration at all; set two env vars to switch it on.

1. In PostHog, **Settings → Project → Project ID**, copy the **project API
   key** — the public `phc_...` token. (Not a `phx_...` personal API key:
   that one is a server credential and must never be shipped to a browser.)
2. Locally, add to `.env.local`:

   ```
   VITE_POSTHOG_PROJECT_TOKEN=phc_...
   VITE_POSTHOG_HOST=https://us.i.posthog.com   # or https://eu.i.posthog.com
   ```

   `VITE_POSTHOG_KEY` is accepted as an alias — PostHog's docs and its setup
   wizard disagree on the name, and picking the wrong one fails silently: the
   app runs normally and simply never sends an event. In dev the console says
   so on boot; in production, check that PostHog shows a recent event.

3. In production, set the same two as Vercel environment variables. They are
   `VITE_`-prefixed, so they are baked into the client bundle at build time —
   a redeploy is needed for a change to take effect.

What gets collected: `$pageview` per route change, and the named events the
app captures on its own actions (`place_created`, `trip_member_invited`,
`notifications_enabled`, …). Signed-in people are identified by their Supabase
user id, with email and name as person properties.

What deliberately does _not_ get collected: **autocapture and session
recording are both off.** Autocapture sends the text of whatever was clicked,
and in this app that text is the trip's private content — a hotel's
reservation details, or the shopping list, where an item _is_ the present. The
same reasoning that lets a viewer be cut off from a whole category applies to
what leaves the device. If you add an event, keep trip content out of its
properties.

Free tier covers this: PostHog's is 1M events/month, far beyond two phones.

## Notes

- Authorization is the app's job, not the database's: the API holds Supabase's secret key, and RLS stays deny-all. Every read and write goes through `requireTripAccess`, which resolves the caller's membership on the trip named in the path.
- Reminders are sent at most once: the dispatcher marks one as sent as it claims it, so an overlapping run can't double-notify. The trade-off is that a push service outage means a missed nudge rather than a retry storm.
- A reminder reaches the devices of its own trip's members and no one else's. Until phase 6 of the accounts work there was no account on a subscription at all, so every due reminder went to every registered device.
- All API data flows through the Express backend; the browser never talks to the database directly.
