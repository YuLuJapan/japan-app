# API Contract: Japan Trip Companion App

**Date**: 2026-07-11 | **Plan**: [plan.md](../plan.md) | **Entities**: [data-model.md](../data-model.md)

Base URL: `/api` (Express app behind one Vercel serverless function). All bodies JSON, UTF-8.

## Conventions

- **Auth**: every route except `GET /api/health` and `GET|POST /api/reminders/dispatch` (which checks `CRON_SECRET` itself) requires `Authorization: Bearer <token>`, and the only token accepted is a **Supabase Auth JWT** — Google OAuth, email + password, or magic-link.

  Missing/wrong → `401 {"error":{"code":"UNAUTHORIZED"}}`.

  **The shared access codes are gone** (2026-08-22, feature 002 phase 6b). `TRIP_ACCESS_CODE` reached every trip in the database and `TRIP_GUEST_CODE` was a fixed narrow view of it; a code proves a right rather than naming a person, so no per-trip membership could constrain either. `POST /api/auth/verify` and `GET /api/auth/session` went with them — a client that wants to check a token calls `GET /api/me`.

- **Membership (2026-08-22, feature 002 phase 2)**: `TRIP_OWNER_EMAILS` is **gone**. Registration is open — anyone may create an account, and sees nothing until they create a trip or are invited to one. Every request resolves two things:
  - **who** (`req.user`, `server/src/lib/identity.ts`) — the account behind the JWT, said without reference to permissions.
  - **access** (`req.access`, `server/src/lib/access.ts`) — exactly the trips they are a member of, with their role on each. There is no "sees everything" context.

  A trip that isn't yours answers **`404`, never `403`** — a 403 would confirm it exists. A member who merely lacks the verb (a viewer writing) gets `403`, because they already know it exists.

  Per-trip roles are `owner` > `partner` > `viewer` (`server/src/lib/permissions.ts`).

- **Sharing (2026-08-22, feature 002 phase 4)**: a trip is shared with a link, not an email. `POST /api/trips/:tripId/invites` mints one and returns the plaintext **exactly once**; only its SHA-256 is stored, so a leaked backup hands out no working invites. `owner` is ungrantable by invite (a schema check constraint, not a service rule).

  | capability                                  | owner | partner  |        viewer        |
  | ------------------------------------------- | :---: | :------: | :------------------: |
  | read trip content                           |   ✓   |    ✓     |          ✓           |
  | read stays · flight · documents             |   ✓   |    ✓     | **per-member flags** |
  | create / edit / delete content              |   ✓   |    ✓     |          ✗           |
  | invite a **viewer**                         |   ✓   |    ✓     |          ✗           |
  | invite a **partner**                        |   ✓   |    ✗     |          ✗           |
  | change roles / visibility · remove a member |   ✓   |    ✗     |          ✗           |
  | revoke an invite                            |  any  | own only |          ✗           |
  | leave the trip                              |   —   |    ✓     |          ✓           |

  `canInvite` takes the **target** role, which is what stops a partner inviting another partner and spreading write access sideways with no owner in the loop.

  **Every trip keeps at least one owner** — enforced in the service, since Postgres cannot express it without a deferred constraint trigger. A trip with no owner is unreachable by anyone, forever.

  **Read-only is enforced at the router.** A viewer is an ordinary signed-in account, indistinguishable at the door from an owner, so `requireTripAccess` refuses non-`GET` for any role that cannot write — one check covering every nested route, present and future. The single exception is `DELETE /members/:userId` on yourself: leaving a trip is a write anyone may make.

  Routes: `GET/PATCH/DELETE /api/trips/:tripId/members[/:userId]`, `GET/POST /api/trips/:tripId/invites`, `DELETE /api/trips/:tripId/invites/:inviteId`, plus `GET /api/invites/:token` (preview) and `POST /api/invites/:token/accept`. Accepting is single-use, idempotent for an existing member, and never a downgrade.

- **The invitation inbox (2026-08-22, feature 002 phase 7)**: an invitation that names an email address is also claimable by the account holding that address, with **no link at all** — `GET /api/invitations`, `POST /api/invitations/:inviteId/accept`, `POST /api/invitations/:inviteId/decline`. This is what makes sending an email optional rather than the mechanism.

  The two entry points authorize differently, and deliberately: the link is authorized by **holding the token**, the inbox by **your confirmed sign-in email matching the invitation**. Confirmed is the whole of it — anyone can type someone else's address at sign-up, so `AuthUser.email_confirmed` (from Supabase's `email_confirmed_at`) gates both listing and claiming. An unconfirmed account gets `{"invitations": [], "email_unconfirmed": true}` rather than a 403: it has done nothing wrong, and nothing leaks, since it already knows its own address.

  An invitation addressed to somebody else answers **404, never 403** — an invitation id is not worth confirming to a caller it does not name. One for a trip you are already on is filtered out rather than offered, since accepting would be a no-op.

  `declined_at` is a state of its own, not a reuse of `revoked_at`: revoked means the inviter withdrew it, declined means the invitee said no, and `GET /api/trips/:tripId/invites` keeps declined rows (labelled) so an invitation never just vanishes from the inviter's list.

- **Per-member visibility (phase 4)**: four flags on `trip_members` — `can_see_stays`, `can_see_flight`, `can_see_documents`, `can_see_shopping` — collapse into one `TripView` (`server/src/lib/trip-view.ts`) that rides on the trip context. Writers always get the full view: the flags are _ignored_ for owner and partner rather than validated, so an owner cannot lock themselves out of their own bookings.

  Enforcement points: place detail (`403` on a hidden stay), zone detail and its category counts, the zone place list including the map's all-categories sweep, the trip bundle's `flight` block (the key is absent, not null), search, files, and the whole `/shopping` subtree.

  **Files: place-attached ones inherit their place.** A hotel's reservation PDF disappears exactly when the stays do. Trip- and zone-attached files are governed solely by `can_see_documents` — a "flight booking.pdf" attached to the trip is a blob with a display name, and the app cannot know what is inside it. So `flight: false` with `documents: true` still shows it; the members screen says so rather than pretending otherwise. Upgrade path if that is not enough: a `files.kind` tag set at upload.

  **Shopping is all-or-nothing.** Unlike the stays, there is no filtered version of a shopping list worth serving — an item on it _is_ what is being kept quiet, which is the point when the list holds a present for the person you are sharing the trip with. `can_see_shopping: false` makes every route under `/api/trips/:tripId/shopping` answer `403 FORBIDDEN`, reads included, via one guard mounted on the path rather than a check per handler.

  Defaults on a new invite: stays **on**, flight **on**, shopping **on**, documents **off**.

- **The trip's title (2026-08-22, feature 002 phase 5)**: `trips.name` is **nullable** and is an _override_, not the title. Every trip payload carries `display_title`, computed server-side from `server/src/lib/trip-title.ts` so there is one implementation and clients cannot drift:

  | given                | title                        |
  | -------------------- | ---------------------------- |
  | a `name`             | that name                    |
  | `people` + `country` | `Yuval and Luciana in Japan` |
  | `country` only       | `Trip to Japan`              |
  | `people` only        | `Yuval and Luciana’s trip`   |
  | neither              | `Untitled trip`              |

  Names come from `trips.people` — the deliberate roster of who is going. Member display names are a fallback used **only** when that roster is empty, because membership answers "who can open the app" and includes anyone the trip was shared with.

  `POST /api/trips` no longer requires `name`; sending `""` on create or patch clears the override rather than storing an empty string. `country` is a new optional field (max 80 chars).

  **The single-trip-era routes are scoped too.** `GET /api/trip`, `/api/itinerary`, `/api/shopping`, `/api/reminders`, `/api/files` and `/api/steps` carry no trip id and used to resolve to the oldest trip _in the database_. They now resolve to the caller's oldest trip, and `404` when they have none.

  **Every content route is now nested (2026-08-22, phase 3a).** They live under `/api/trips/:tripId/…` behind a single `requireTripAccess` middleware (`server/src/lib/trip-context.ts`), applied once to the whole router — so a route added there is access-checked by construction rather than by remembering to guard it:

  ```
  /api/trips/:tripId            GET · PATCH · DELETE   (the bundle)
  /api/trips/:tripId/date-impact                 GET
  /api/trips/:tripId/steps      /steps/:stepId
  /api/trips/:tripId/zones/:zoneId               /zones/:zoneId/places
  /api/trips/:tripId/places     /places/:placeId
  /api/trips/:tripId/tips       /tips/:tipId
  /api/trips/:tripId/itinerary  /itinerary/:itemId
  /api/trips/:tripId/shopping   /shopping/:itemId
  /api/trips/:tripId/reminders  /reminders/:reminderId
  /api/trips/:tripId/files      /files/:fileId · /files/:fileId/url · /files/:fileId/content
  ```

  `/api/trips/:tripId/search` joins them (phase 3a-ii).

  **The flat and singleton routes are gone (phase 3a-ii).** `/api/trip`, `/api/itinerary`, `/api/shopping`, `/api/reminders`, `/api/files`, `/api/steps`, `/api/places`, `/api/tips`, `/api/zones/:zoneId` and `/api/search` all answer `404`. Reaching trip content without naming the trip is no longer expressible, and `getDefaultTrip` — which once resolved to "the oldest trip in the database" — no longer exists.

  Still at `/api`, none of them trip content: `/health`, `/auth/*`, `/me`, `/trips` (the collection — listing and creating happen before there is a trip to be a member of), `/rates`, `/geocode`, `/images`, `/product-preview`, `/translate`, `/push/*`, and `/reminders/dispatch` (called by an external scheduler with no trip in hand, guarding itself with `CRON_SECRET`).

  **Nesting proves membership; scoping proves ownership.** The router check answers "are you a member of the trip in the path"; the store's trip id answers "does this row belong to that trip". Both are needed, and `server/tests/tenancy.test.ts` sweeps both — 60 cases, derived from the router's own Express stack so a new route is covered automatically.

  **Zones belong to a trip (2026-08-22, phase 3b, migration 0013).** Every row in the system now resolves to exactly one trip, and every trip-owned `DataStore` method takes the trip id as its first argument — scope lives in the query, so a forgotten check is a TypeScript error rather than a code-review note.

  Two consequences worth knowing:
  - `/api/trips/A/places/<place-in-B>` answers `404`, and so does every other cross-resource combination. A place cannot be moved into another trip's zone, a tip cannot be hung off one, and a journey step cannot point at one.
  - **Find-or-create is per trip.** Adding "Tokyo" to a second trip creates that trip's own Tokyo, with its own places and notes, rather than sharing the first trip's. Two trips to the same city no longer see each other's restaurants.

  The reachability workaround this replaced (walking journey steps on every read) is gone.

  > **Correction (phase 3a-ii)**: phase 2 documented search as scoped when it was not — `GET /api/search` ran catalog-wide with no access check, so any account could read place names, zone names and the first 80 characters of any tip from any trip. Fixed and covered by regression tests in `server/tests/membership.test.ts`.

- **Accounts (2026-08-22 addition, feature 002 phase 1)**: authentication and authorization are now separate steps. `server/src/lib/identity.ts` resolves a token to a **principal** — either a signed-in account or one of the deprecated static codes — and says nothing about permissions; `server/src/lib/auth.ts` then decides the role. A token can therefore verify perfectly and still buy nothing: a Google account that isn't allow-listed gets `401`, not `403`, because it holds no role at all.

  Verified JWTs are cached in-process for 60s (rejections for 10s) so a warm serverless instance doesn't re-verify on every call. A signed-in account is mirrored into the `profiles` table on its first authenticated request of each 5-minute window; that write is **best-effort and never fails the request** — an unmigrated database degrades to "no profile row", not to a 500.

  (Phase 1 gated this on a `TRIP_OWNER_EMAILS` allow-list; phase 2 replaced it with the membership rules above.)

- **Withheld content** (2026-08-13, generalised into per-member flags in phase 4 and freed of the guest code in 6b — `server/src/lib/trip-view.ts`). A `hotel` place _is_ the accommodation booking (price, confirmation, cancellation terms and the Booking.com link live in its free-text `description`/`links`), and the `flight` block carries the booking reference, so for a member whose view withholds them:
  - `GET /api/trips/:tripId/places/:placeId` on a `hotel` place → `403 FORBIDDEN`;
  - `GET /api/trips/:tripId/zones/:zoneId/places` never returns `hotel` places — with `category=hotel`, or in the all-categories (`category=`) sweep;
  - `place_counts.hotel` is always `0`, in zone detail and in the `steps[].zone` summaries of the trip bundle;
  - the trip bundle omits `flight` entirely (the key is absent, not `null`);
  - `GET /api/trips/:tripId/search` drops `hotel` places and any tip whose parent is one;
  - itinerary items keep their `title`/`note` but come back with `place_id: null` when it pointed at a `hotel`;
  - anything under `/api/trips/:tripId/files` → `403 FORBIDDEN`, reads included, and the `files` array in zone/place responses comes back `[]`;
  - anything under `/api/trips/:tripId/shopping` → `403 FORBIDDEN`, reads included, when `can_see_shopping` is off.

  These are reads, so none of it can be done by HTTP method — each read path takes the `TripView` from the trip context. The bundle also reports that view back as `shows: {stays, flight, documents, shopping}`, which is the only way a client can tell "nothing saved here" apart from "not shared with you".

- **Error envelope**: `{"error":{"code":"<MACHINE_CODE>","message":"<human text>"}}`. Codes: `UNAUTHORIZED`, `FORBIDDEN` (403), `NOT_FOUND`, `VALIDATION` (400, with `details` array), `FILE_MISSING` (404), `INTERNAL` (500).
- **IDs** are UUID strings. Timestamps ISO-8601. Dates `YYYY-MM-DD`.
- Successful `DELETE` → `204` no body.
- **2026-07-11 addition**: zones and places carry an optional `image_url` (http(s) photo). It appears in zone summaries (GET /api/trip), zone detail, place list items, and place detail; accepted on place POST/PATCH (validated as http(s) URL).

## Auth

### GET /api/invitations

Invitations waiting for the signed-in account — those addressed to its email. Carries no trip content; an unaccepted invitation is not access.

- 200: `{"invitations": [{"id","trip_name","role","invited_by","email","expires_at","shows":{…}}]}`
- 200: `{"invitations": [], "email_unconfirmed": true}` when Supabase has not confirmed the address. Not an error — the account simply hasn't proved the address is theirs.
- `trip_name` is the computed `display_title`, never the raw `name` (which is null for a trip that goes by its built title).

### POST /api/invitations/:inviteId/accept

- 200: `{"trip_id","role","already_member"}` · 403 when the address is unconfirmed · 404 for an invitation that is not open, or is addressed to someone else.

### POST /api/invitations/:inviteId/decline

- 204 · 403 unconfirmed · 404 as above. Stamps `declined_at`; the invitation cannot then be accepted.

### GET /api/me

The signed-in account, as the app knows it.

Also what the gate calls to confirm a fresh token before it navigates: Supabase accepting a sign-in and this API accepting it are two different things.

- 200: `{"user": {"id":"…","email":"…","display_name":"…|null","avatar_url":"…|null"}}`
- 401 when the token is not valid.

`user` prefers the stored `profiles` row over the token's claims, so a display name edited in the app wins over the one the provider last sent.

## Trip & journey

**Multi-trip (2026-08-08 addition):** the app now supports more than one trip — `GET /api/trips` lists them, `POST /api/trips` creates one, and `GET/PATCH/DELETE /api/trips/:tripId` operate on a specific trip. `people` is a free-text array of travellers on the trip itself (not linked accounts — there is no per-trip membership/sharing model, login, or delivered email; `email` is optional and only ever used client-side to open a `mailto:` invite). `GET /api/trip` (singular, no id) is kept as a **legacy alias** for `GET /api/trips/:tripId` on whichever trip is oldest, so the pre-multi-trip UI keeps working; new code should call the plural routes. Journey steps, itinerary, shopping, reminders and file upload are **not yet trip-scoped in their routes** — they still operate on that same oldest trip regardless of how many trips exist, until the UI can actually switch between trips (tracked as a follow-up; trip CRUD itself has no such limitation).

**Traveller shape (2026-08-09 addition):** each entry in `people` is `{"name":"…","email?":"…"}`. A plain string is also accepted on write (normalized to `{"name": "…"}`) for backward compatibility with older clients and rows written before this change; the response always uses the object form.

### GET /api/trips

The caller's trips, oldest first (powers the "Where to next?" trips list). An account that is a member of nothing gets `{"trips": []}` — not everybody else's.

- 200: `{"trips": [{"id":"…","name":"…","start_date":"…","end_date":"…","description":"…","people":[{"name":"Yuval"},{"name":"Luciana","email":"luciana@example.com"}]}]}`

### POST /api/trips

- Request: `{"name":"…","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","description?":"…","people?":[{"name":"…","email?":"…"} | "…"],"local_currency?":"THB","home_currencies?":["USD","ILS"]}`
- 201: `{"trip": {…}}` · 400 `VALIDATION` (missing/blank name, bad dates, end before start, name/description too long, more than 12 travellers, a traveller missing a name, a traveller name too long, an `email` that isn't a valid address, or a currency outside the supported list).

> **The trip's currencies (2026-08-22, migration 0019)**: every trip carries `local_currency` (what money is spent at the destination) and `home_currencies` (1–3 codes to convert it into) — the two sides of the exchange calculator, which was hard-coded to JPY → USD/ILS before. Both are optional on write and default to exactly that, so an older client creates a trip that behaves as it always did. Codes are validated against `server/src/lib/currencies.ts` (the same list `GET /api/currencies` serves the pickers), uppercased and de-duplicated on the way in; `home_currencies` must hold between 1 and 3 of them. Both are ordinary trip fields — `PATCH /api/trips/:tripId` changes them, and they are never withheld by a member's view.

> **`my_role` and `shows` (2026-08-22)**: the trip bundle (`GET /api/trips/:tripId`) carries `"my_role": "owner" | "partner" | "viewer"` — what this caller may do here — and `"shows": {"stays":bool,"flight":bool,"documents":bool,"shopping":bool}` — what they are shown. `POST /api/trips` carries `my_role` and always makes its creator an `owner`. Both drive which buttons the UI offers and how it explains an absence; neither is ever what decides whether a request succeeds.

### GET /api/trips/:tripId

The whole journey skeleton for one trip — powers the Journey (home) view and offline-ish caching (one query serves SC-002/SC-006). `GET /api/trip` (no id) is the legacy equivalent for the oldest trip.

- 200:

```json
{
  "trip": {
    "id": "…",
    "name": "Japan 2026",
    "start_date": "2026-10-05",
    "end_date": "2026-10-24",
    "description": "…",
    "people": [{ "name": "Yuval" }, { "name": "Luciana", "email": "luciana@example.com" }]
  },
  "steps": [
    {
      "id": "…",
      "position": 1,
      "start_date": "2026-10-05",
      "end_date": "2026-10-10",
      "zone": {
        "id": "…",
        "name": "Tokyo",
        "name_ja": "東京",
        "summary": "…",
        "place_counts": { "hotel": 1, "attraction": 8, "food": 6, "shopping": 3, "other": 2 }
      }
    }
  ],
  "trip_files_count": 4,
  "flight": {
    "airline": "Ethiopian Airlines",
    "booking_ref": "ABC123",
    "outbound": {
      "depart_at": "2026-09-18T15:35:00+03:00",
      "depart_tz": "Asia/Jerusalem",
      "arrive_at": "2026-09-19T19:40:00+09:00",
      "arrive_tz": "Asia/Tokyo",
      "legs": [{ "flight_no": "ET 419", "from": "Tel Aviv (TLV)", "to": "Addis Ababa (ADD)" }]
    },
    "return_flight": {
      "depart_at": "2026-10-16T20:40:00+09:00",
      "depart_tz": "Asia/Tokyo",
      "arrive_at": "2026-10-17T14:35:00+03:00",
      "arrive_tz": "Asia/Jerusalem",
      "legs": [{ "flight_no": "ET 673", "from": "Narita (NRT)", "to": "Addis Ababa (ADD)" }]
    }
  }
}
```

> **Writing the flight (2026-08-23)**: `flight` is accepted by `POST /api/trips`
> and `PATCH /api/trips/:tripId`, so a booking is attached from the trip form
> rather than seeded by a migration. `trips.flight` is still jsonb and its shape
> is unchanged — **no migration is needed**, because extra `legs` already _were_
> the way a connection is expressed.
>
> Everything except `legs` is optional. A leg needs a `flight_no`; `from`/`to`,
> the airline, the booking reference and all four time fields may be omitted, so
> flight numbers can be recorded now and times looked up later. Times are
> validated and stored **in pairs** — `depart_at` without `depart_tz` is a `400`,
> because an instant without its zone renders in whichever zone the reader's
> phone is in, which is what the stored zones exist to prevent. A direction with
> no legs is read as absent; with neither direction present the whole booking is
> `null`. One direction alone is valid — a one-way booking, or a return not
> booked yet.
>
> Omitting the key leaves the stored booking untouched; `"flight": null` clears
> it. That distinction is load-bearing for the client: the trip sheet reads the
> booking from the bundle, which resolves _after_ the sheet opens, so it omits
> `flight` entirely until it has one — otherwise saving early would blank a
> booking nobody edited.

> **When the trip begins (2026-08-23, migration 0020)**: `start_time` (`"HH:MM"`)
> and `start_tz` (IANA) are optional, nullable, and accepted by both trip
> endpoints. They exist so the countdown can target the real start of a trip
> without anyone filling in a booking to correct one number — it previously used
> `start_date` at a hardcoded 09:00 local.
>
> The same pair rule as the flight times: a `start_time` without a `start_tz` is
> a `400`, or the countdown would shift the moment a phone changed zone
> mid-trip. `start_time` is validated as real hours and minutes, not just two
> digits and a colon — `"25:00"` would otherwise roll the countdown into the
> next day. Both null means "no particular time" and restores the 09:00 guess.
>
> `start_date` stays a plain `date` and is unchanged: every range rule in the
> app compares against it, and widening it to a timestamptz would put a time
> into all of those comparisons, where an evening start could exclude its own
> first day.

- Current/past/future step status is **computed client-side** from device date (FR-006).
- `flight` is the trip's own booking, stored as `trips.flight` jsonb (migration 0017) and read back through `normalizeFlight` in `server/src/lib/flight.ts` — a malformed value reads as no flight rather than reaching the client half-formed. It was a module constant until phase 6, which meant every trip anyone created was served the two travellers' booking reference. `outbound.depart_at` is the countdown target; the `*_tz` fields are IANA zones so ticket times render the same on a phone set to Israel or to Japan. **Absent** both for a trip with no booking attached and for a caller whose view withholds it, along with any `place_counts.hotel` — clients must treat `flight` as optional (the UI falls back to a plain countdown on the trip's `start_date`), and cannot tell the two cases apart. There is no endpoint that writes it yet.

### PATCH /api/trips/:tripId

- Request: any subset of `{"name","start_date","end_date","description","people"}`, plus optional `"stranded_activities": "move" | "delete"` and `"stranded_stops": "move"` (see below).
- 200: `{"trip": {…updated…}[, "moved_stops": ["…step ids…"]][, "moved": ["…item ids…"]][, "deleted": ["…item ids…"]]}` · 400 `VALIDATION` · 404 unknown trip.

Changing the dates can strand what is already planned inside the old range — the mirror of the rule steps and itinerary items enforce on the way in: **the trip's dates always contain everything planned on it**. Either kind of conflict is a 400 unless the request says what to do about it:

- `stranded_stops: "move"` re-dates each stranded step to the trip's new `start_date`, keeping its length (`end_date` clipped to the trip's end when the trip is now too short to hold the stay). Several stranded stops therefore land on top of each other and want re-spacing on the journey editor. Deleting a stop is **not** offered here — that rearranges the journey and belongs to the journey editor's own confirmed delete.
- `stranded_activities: "move"` re-dates each stranded item to the new `start_date` (everything else about the activity is untouched); `"delete"` removes them.

Resolving stops from here is what makes a trip's dates movable at all. A step's dates are themselves pinned to its trip, so "fix the stop first, then the dates" is a deadlock: the stop cannot leave the window the trip still has, and the trip cannot leave the window the stop is in. Postponing a trip wholesale is impossible without this.

The response echoes the affected ids; the fields are absent when the change strands nothing. The trip row is written before its stops and activities are moved, and the two halves are not in one transaction (the DataStore has none). If the second half fails, the dates are already correct and re-saving with the same choices retries it.

### GET /api/trips/:tripId/date-impact?start_date=&end_date=

Dry run for the above: what a date change _would_ strand, so the client can list it and ask before committing. Either query param may be omitted to keep the trip's current value.

- 200: `{"range":{"start_date","end_date"},"steps":[{"id","start_date","end_date","zone_name"}],"items":[{"id","day","start_time","title","highlight"}]}` — empty arrays mean the change is clean.
- 400 `VALIDATION` (bad date, end before start) · 404 unknown trip.
- Read-only, so any member may call it; the `PATCH` it precedes is refused for a viewer by method.

### DELETE /api/trips/:tripId

Hard delete. Cascades to the trip's journey steps, itinerary items, shopping items, reminders and files (zones/places are a shared catalog and are not deleted).

- 204 · 404.

## Journey steps

Self-service editing of the trip schedule (which destinations, over what dates). Steps carry no client-controlled order — `GET /api/trip` always returns them **sorted by `start_date`**, so a destination added with an earlier date automatically appears earlier in the list. `position` is an internal bookkeeping field (assigned on create, never patched) and is not meaningful to clients.

A destination is given either as an existing `zone_id` or as free-text `destination` (the name + coordinates of a real place, e.g. from a geocoder-backed autocomplete on the client — see `GET /api/geocode`). Exactly one of the two is required on create. When `destination` is given, the server reuses an existing zone whose name matches (case-insensitive); otherwise it creates a new zone from the destination's name/lat/lng.

A step's `start_date`/`end_date` must both fall within its trip's own `start_date`/`end_date` — no stop before the trip starts or after it ends.

### POST /api/steps

- Request: `{"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","zone_id":"…"} | {"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","destination":{"name":"…","address?":"…","lat":n,"lng":n}}`
- 201: `{"step": {"id":"…","trip_id":"…","zone_id":"…","position":n,"start_date":"…","end_date":"…"}}` · 400 `VALIDATION` (missing zone_id/destination, bad dates, end before start, dates outside the trip's own range, bad destination name/lat/lng) · 404 unknown zone (when `zone_id` given).
- **Trip-scoped (2026-08-08 addition):** `POST /api/trips/:tripId/steps` is the same route pointed at a specific trip instead of the legacy default (oldest) trip — same request/response shape.

### PATCH /api/steps/:stepId

- Request: any subset of `{"zone_id","destination","start_date","end_date"}`. Dates are cross-checked against the merged (existing + patched) values, so patching just one date still enforces end ≥ start and both within the trip's own range.
- 200: `{"step": {…updated…}}` · 400 `VALIDATION` · 404 unknown step or zone.

### DELETE /api/steps/:stepId

- 204 · 404.

## Zones

### GET /api/zones/:zoneId

Zone header + zone-level tips + zone-level files + per-category counts (drives category visibility, FR-012).

- 200:

```json
{
  "zone": { "id": "…", "name": "Kyoto", "name_ja": "京都", "summary": "…" },
  "tips": [{ "id": "…", "body": "Buy the bus day pass at…" }],
  "files": [
    {
      "id": "…",
      "display_name": "Kyoto walking map",
      "mime_type": "application/pdf",
      "size_bytes": 123456
    }
  ],
  "place_counts": { "hotel": 1, "attraction": 5, "food": 4, "shopping": 0, "other": 1 }
}
```

- 404 `NOT_FOUND` for unknown id.

### PATCH /api/trips/:tripId/zones/:zoneId

The zone's photo, and only that. Zones were read-only until 2026-08-23 — the
`image_url` migration 0001 seeded onto a city was the only one it could have.
`name`, `name_ja` and `summary` stay read-only on purpose: journey steps and the
search index read them, and nothing has asked to change them.

No migration — `zones.image_url` has existed since 0001.

- Body: `{"image_url": "https://…"}`. `null` **or** `""` clears it, and the UI
  falls back to its gradient. Omitting the key leaves the photo alone.
- Must start with `http://` or `https://` and be at most 2000 characters → else
  400 `VALIDATION`. That rules out `javascript:` and `data:` URLs, which would
  otherwise reach an `<img src>`.
- 200: `{"zone": {…}}`.
- 404 `NOT_FOUND` for a zone that is not in this trip — the store scopes the
  write by `trip_id` in the same statement, so a zone id belonging to another
  trip is never quietly writable.
- Access is the usual: the route is mounted on the trip-scoped router, so a
  viewer gets 403 and a non-member 404 without this route deciding anything.

### GET /api/zones/:zoneId/places?category=food

Places of one category in a zone, list form (name + summary line, FR-002).

- `category` required, one of `hotel|attraction|food|shopping|other` → else 400 `VALIDATION`.
- 200: `{"places":[{"id":"…","name":"…","name_ja":"…","category":"food","summary_line":"first ~100 chars of description"}]}` (may be empty — UI renders empty state, FR-012).
- A member whose view withholds the stays never gets `hotel` places here: `category=hotel` returns `{"places":[]}`, and the all-categories sweep (`category=`, used by the city map) filters them out.

## Itinerary (day-by-day activities)

A flat list of timed/untimed activities per trip; the client groups them by day. Distinct from journey steps above — an itinerary item is a single activity within a day, optionally linked to a saved place.

An item's `day` must fall within its trip's own `start_date`/`end_date` — the same rule journey steps follow. Nothing is planned before the trip starts or after it ends.

### GET /api/itinerary

- 200: `{"items":[{"id":"…","trip_id":"…","zone_id":"…","place_id":"…","day":"YYYY-MM-DD","start_time":"HH:MM"|null,"title":"…","note":"…"|null,"position":0,"highlight":false,"icon":"…"|null}]}`
- When the stays are withheld, an item that pointed at a `hotel` place comes back with `place_id: null` — the day still reads the same, it just doesn't link to a page that would answer 403.

### POST /api/itinerary

- Request: `{"day":"YYYY-MM-DD","title":"…","zone_id?","place_id?","start_time?":"HH:MM","note?","position?","highlight?","icon?"}`
- 201: `{"item": {…}}` · 400 `VALIDATION` (missing title/bad day/bad time/day outside the trip's own dates) · 404 unknown zone.

**Trip-scoped (2026-08-08 addition):** `GET|POST /api/trips/:tripId/itinerary` are the same two routes pointed at a specific trip instead of the legacy default (oldest) trip — same request/response shapes.

### PATCH /api/itinerary/:itemId

- Request: any subset of the POST fields. Last write wins. A patched `day` is re-checked against the item's own trip's dates.
- 200: `{"item": {…updated…}}` · 400 · 404 (unknown item or zone).

### DELETE /api/itinerary/:itemId

- 204 · 404.

## Places

### GET /api/places/:placeId

Full detail incl. tips and files (US1 AC2/AC3, US4 AC1).

**`place.summary_line`** rides along on every place the API returns (detail, create, update), derived from the description by `server/src/lib/place-view.ts` — the same function the zone's category lists use for their rows. It is there so a client can put an edited place straight back into the list it came from instead of recomputing a rule that lives on the server.

- 200:

```json
{
  "place": {
    "id": "…",
    "zone_id": "…",
    "category": "food",
    "name": "…",
    "name_ja": "…",
    "description": "…",
    "address": "…",
    "links": [{ "label": "Tabelog", "url": "https://…" }]
  },
  "tips": [{ "id": "…", "body": "…" }],
  "files": [{ "id": "…", "display_name": "…", "mime_type": "…", "size_bytes": 123 }]
}
```

- `403 FORBIDDEN` when the place is a `hotel` and this member's view withholds the stays — the stay carries the accommodation booking (see **Withheld content**).

### POST /api/places (FR-015, SC-008)

- Request: `{"zone_id":"…","category":"food","name":"…","name_ja?":"…","description?":"…","address?":"…","links?":[…]}`
- 201: `{"place": {…full place…}}` · 400 `VALIDATION` (missing name/zone/bad category) · 404 unknown zone.

### PATCH /api/places/:placeId (FR-015)

- Request: any subset of the POST fields. Last write wins.
- 200: `{"place": {…updated…}}` · 404 · 400.

### DELETE /api/places/:placeId (FR-015, FR-017)

- Confirmation is a UI concern; the API deletes immediately. Place's tips cascade; its files are re-parented to the trip (see data-model note — no silent file loss).
- 204 · 404.

## Tips

### POST /api/tips (FR-016)

- Request: `{"body":"…","zone_id":"…"} | {"body":"…","place_id":"…"}` — exactly one parent, else 400.
- 201: `{"tip":{…}}`.

### PATCH /api/tips/:tipId

- Request: `{"body":"…"}` → 200 `{"tip":{…}}` · 404.

### DELETE /api/tips/:tipId (FR-017)

- 204 · 404.

## Shopping list

Trip-level list of things to buy in Japan: what it is, where to buy it, what it should cost (yen), a photo, and whether it's been bought. Not tied to a zone, though an item may name the city its shop is in (`zone_id`). `category` is one of `clothes|haircare|skincare|health|snacks|tech|home|souvenir|other` (defaults to `other`) — the client groups the list into one carousel per category (migration 0008 split the original `beauty` bucket).

### GET /api/shopping

- 200: `{"items":[{"id":"…","trip_id":"…","name":"Onitsuka Tiger Mexico 66","category":"clothes","note":"Size 42"|null,"shop":"ABC Mart"|null,"zone_id":"…"|null,"price_yen":12000|null,"url":"https://…"|null,"image_url":"https://…"|null,"bought":false,"position":0}]}`
- Ordered **unbought first**, then `position`, then insertion order — bought items sink to the bottom of the list.

### POST /api/shopping

- Request: `{"name":"…","category?":"clothes","note?","shop?","zone_id?","price_yen?":12000,"url?","image_url?","bought?":false}`
- 201: `{"item": {…}}` · 400 `VALIDATION` (missing name, unknown category, negative/non-numeric `price_yen`, non-http(s) `url`/`image_url`) · 404 unknown zone.

**Trip-scoped (2026-08-08 addition):** `GET|POST /api/trips/:tripId/shopping` are the same two routes pointed at a specific trip instead of the legacy default (oldest) trip — same request/response shapes.

**Hidden for a member without `can_see_shopping` (2026-08-22):** every route under `/api/trips/:tripId/shopping` answers `403 FORBIDDEN`, reads included. The whole section or none of it — see "Per-member visibility" above.

### PATCH /api/shopping/:itemId

- Request: any subset of the POST fields — `{"bought": true}` is the tick-off action. Last write wins.
- 200: `{"item": {…updated…}}` · 400 · 404.

### DELETE /api/shopping/:itemId

- 204 · 404.

## Photos

### GET /api/images?q=Onitsuka+Tiger

Web photo lookup for items with no picture of their own, so a list never shows blank tiles. Backed by the Wikimedia APIs (Wikipedia article images + Commons files) — keyless and free, matching the project's $0 constraint. Results are cached in-process for an hour.

- `q` required, ≥ 2 characters → else 400 `VALIDATION`. `limit` optional (default 8, max 12).
- 200: `{"results":[{"url":"https://…full.jpg","thumb_url":"https://…600px.jpg","title":"…","source":"wikipedia|commons","source_url":"https://…"|null,"credit":"Jane Doe · CC BY-SA 4.0"|null}]}`
- **Never fails on the upstream's behalf**: an unreachable, slow (>4s) or rate-limited Wikimedia returns `{"results":[]}`, not a 5xx.
- Files a browser can't render as a photo (`.svg`, video, TIFF) are filtered out.

`POST /api/shopping` uses the same lookup: an item created **without** `image_url` gets the top hit stamped in automatically (searching the item name, plus the shop when it adds context, then falling back to just the brand words). That lookup is best-effort — if it finds nothing or the API is down, the item saves with `image_url: null`. Supplying `image_url` yourself skips the search entirely.

### GET /api/product-preview?url=https://shop.example.jp/p/123

Reads a shop's own product page so an item can be added by pasting its link. Parses the metadata shops already publish for social previews — Open Graph tags, then schema.org JSON-LD — with no HTML-parsing dependency.

- 200: `{"url":"https://…(where the redirects landed)","name":"…"|null,"name_ja":"クルーネックT"|null,"image_url":"https://…"|null,"shop":"UNIQLO"|null,"price_yen":1500|null,"price_note":"Listed at 49 EUR — set the yen price yourself."|null}`
- **Names come back in English.** Shop titles mix the brand in on both sides of the separator depending on locale ("Product | UNIQLO" vs "ユニクロ公式 | Product"), so segments matching the shop name or storefront boilerplate ("公式", "online store") are dropped and the most descriptive one kept. If the result is still Japanese, the shop's own English page is tried (`/jp/ja/…` → `/jp/en/…`), then `GET /api/translate`. `name_ja` carries the Japanese original whenever `name` is a translation — worth keeping to show staff in the shop.
- **Prices** are looked for in four places, in descending order of trust: OG/product meta, schema.org JSON-LD, numbers under price-ish keys in embedded JSON (shops that price client-side, Uniqlo among them, publish no meta tag but ship the number in the page), and finally visible `¥1,500` / `1,500円` text with free-shipping thresholds ("¥5,000以上…") filtered out.
- 400 `VALIDATION` for a non-http(s) scheme, an unparseable URL, or an address inside our own network (see below).
- **A page it can't read is not an error**: unreachable host, non-HTML response, or no useful tags → 200 with the fields it couldn't fill set to `null`, so the form still keeps the link.
- **Prices**: JPY is taken as-is; any other currency `GET /api/rates` quotes against JPY is converted (USD and ILS were the only two before 0019); anything it doesn't quote comes back as `price_yen: null` plus a `price_note` rather than a guess. A price with no stated currency on a Japanese shop is treated as yen.
- **Fetching a URL the client chose is guarded** (this runs inside our own network): http(s) only; hostnames and resolved addresses in loopback/private/link-local ranges are refused (which covers names like `localtest.me` that resolve to `127.0.0.1`, and the `169.254.169.254` cloud-metadata address); redirects are followed manually, max 3, each hop re-checked; 6s timeout; the read stops after 512 KB. Only parsed fields are returned — never the page body.

### GET /api/translate?q=クルーネックT

Japanese → English, for product names read off Japanese shop pages and for anything typed in Japanese. Backed by MyMemory's free keyless endpoint (no account, inside the $0 constraint); results are cached in-process.

- `q` required → else 400 `VALIDATION`.
- 200: `{"text":"…(as given)","is_japanese":true,"translated":"Crew Neck T-Shirt"|null}`
- `translated` is `null` — never an error — when the text isn't Japanese, the service is down or over quota, or it echoed the input back. Callers keep the original in that case.

## Money

### GET /api/rates?base=JPY&symbols=USD,ILS

Today's exchange rate for the calculator on the Essentials screen. Both parameters are optional: `base` defaults to `JPY` (what every trip was before the currency could be chosen) and no `symbols` means every rate the provider quotes. Callers pass the trip's `local_currency` and `home_currencies`.

- 200: `{"base":"JPY","date":"2026-08-01","rates":{"USD":0.0067,"ILS":0.025},"missing":[]}` — each rate is **1 unit of `base`** in that currency.
- `missing` names requested codes the provider had no rate for today, so the UI can say so instead of showing a blank card.
- 400 `VALIDATION` for a `base` or `symbol` outside the supported list (`server/src/lib/currencies.ts`).
- **Never fails on the provider's behalf when it can help it.** Rates come from open.er-api.com (keyless, free — the $0 constraint) and every successful fetch is written to `exchange_rates`, one row per base currency. A failed fetch falls back to that stored row, then to the ~6h in-process cache; only a cold start with no stored rate for that base is an error.

### GET /api/currencies

The currencies a trip can be priced in, and the guess to make from a country. Static, but served rather than duplicated in the client — the list filling the trip sheet's pickers is the same one that validates what they save.

- 200: `{"currencies":[{"code":"USD","name":"US Dollar"},…],"by_country":{"japan":"JPY","thailand":"THB",…}}`
- `by_country` is keyed by lowercased country name and is a **hint only**: the trip sheet pre-fills the currency from the country until the traveller picks one themselves.

## A write answers with the row its list renders

**Every `POST` and `PATCH` returns the same shape the matching `GET` returns per item.** Not the bare database row — the row the list actually shows, assembled the same way:

| write         | answers with                                                      | assembled by                                                         |
| ------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| places        | the place plus `summary_line`                                     | `lib/place-view.ts`, shared with the zone's category lists           |
| journey steps | the journey card: dates, position, and the `zone` with its counts | `lib/step-view.ts`, shared with the trip bundle                      |
| files         | the document row, `attached_to` and its parent's name included    | `documentView` in `services/files.ts`, shared with the Documents tab |

This is what lets a client show a change the moment it lands instead of asking for it again: it has the row, so it puts it where the list keeps it. **Anything new returning an entity should answer with the shape its list renders** — and where a list is ordered, the order belongs to the datastore, mirrored in `src/lib/ordering.ts` and pinned by `server/tests/ordering.test.ts` so the two cannot drift apart quietly.

_Shape change (2026-08-27):_ `POST|PATCH /steps` used to answer with the raw `journey_steps` row (`trip_id`, `zone_id`); it answers with the card now, so `step.zone.id` replaces `step.zone_id`.

## Files

### GET /api/files

All documents attached to the (legacy, oldest) trip: files on the trip itself, plus files on any zone/place visited by one of its journey steps (US4 AC3).

- 200: `{"files":[{"id":"…","display_name":"…","mime_type":"…","size_bytes":123}]}`

**Trip-scoped (2026-08-08 addition):** `GET|POST /api/trips/:tripId/files` are the same two routes pointed at a specific trip instead of the legacy default (oldest) trip — same request/response shapes, same 403 for a member without `can_see_documents`.

### GET /api/files/:fileId/url (FR-008)

Short-lived signed URL for opening/downloading the blob.

- 200: `{"url":"https://…signed…","expires_in":300}`
- 404 `NOT_FOUND` (no such row) · 404 `FILE_MISSING` (row exists, blob gone — spec edge case, distinct code so the UI can explain).

### GET /api/files/:fileId/content (FR-008)

The blob itself, streamed through the API so the app can render it in the preview
screen (`/files/:fileId`) instead of handing it to the browser's downloader. Same
response for both datastore backends, unlike `/url`.

- 200: the raw bytes. `Content-Type` is the stored mime type; `Content-Disposition: inline; filename*=UTF-8''…` (the display name plus the extension its mime type implies); `X-Content-Type-Options: nosniff`; `Cache-Control: private, max-age=300`.
- Query: `?download=1` switches the disposition to `attachment`.
- 404 `NOT_FOUND` / 404 `FILE_MISSING` — same two variants as `/url`.

### PATCH /api/trips/:tripId/files/:fileId

Rename a document. The display name is the only field there is to change: the blob is keyed by `storage_path` (a uuid assigned at upload) and is never touched, and the extension a download gets is derived from the stored mime type, so no rename can leave a file unopenable.

- Request: `{"display_name":"Flights — Tokyo"}` — trimmed, 1–120 characters, the same rule the upload applies (and the same check constraint the column carries).
- 200: `{"file":{"id":"…","display_name":"…","mime_type":"…","size_bytes":123}}`
- 400 `VALIDATION` (empty or over-long name) · 404 `NOT_FOUND` (no such file, or it belongs to another trip) · 403 for any role that cannot write.
- No `can_see_documents` check of its own: this is a write, so a viewer never reaches it, and a role that can write is given the full view — there is no caller who may rename a file they cannot see.

**Client-side rollout:** the UI for this sits behind the `files-rename` PostHog flag (`src/lib/flags.ts`), defaulting to off. The endpoint itself is always live — a flag is a rollout control, not an access control, and gating the route would only add a way for a correctly-authorised request to fail.

## Reminders & notifications

Scheduled nudges ("book the ryokan") delivered as web push notifications. `remind_at` is always an absolute instant (ISO 8601, returned in UTC) so both phones fire together regardless of which zone they're set to; `time_zone` is the IANA zone the wall clock was typed in, kept for display only.

### GET /api/reminders

- 200: `{"reminders":[{"id":"…","trip_id":"…","title":"…","body":null,"url":null,"remind_at":"2026-09-12T00:00:00.000Z","time_zone":"Asia/Tokyo","sent_at":null,"created_at":"…"}]}` — soonest first.

### POST /api/reminders

- Request: `{"title":"…","remind_at":"2026-09-12T09:00:00+09:00","body?":"…","url?":"https://… | /places/…","time_zone?":"Asia/Tokyo"}`
- 201: `{"reminder":{…}}` · 400 `VALIDATION` (missing title, unparseable `remind_at`, bad `url` scheme, unknown time zone).

**Trip-scoped (2026-08-08 addition):** `GET|POST /api/trips/:tripId/reminders` are the same two routes pointed at a specific trip instead of the legacy default (oldest) trip — same request/response shapes.

### PATCH /api/reminders/:reminderId

- Request: any subset of the POST fields. Moving an already-sent reminder into the future clears `sent_at`, re-arming it.
- 200: `{"reminder":{…}}` · 400 · 404.

### DELETE /api/reminders/:reminderId

- 204 · 404.

### GET|POST /api/reminders/dispatch

Called by the external scheduler, not by the app (see README "Reminders & notifications"). **Exempt from the access-code middleware**; authenticates with `CRON_SECRET` as `Authorization: Bearer …` or `?key=…`, falling back to the trip access code when `CRON_SECRET` is unset. Claims every unsent reminder whose time has passed — stamping `sent_at` in the same operation, so overlapping runs can't double-send — and pushes it to every subscribed device.

- 200: `{"due":1,"subscriptions":2,"sent":2,"failed":0,"dropped":0}` · 401.

Each due reminder goes to the devices of **its own trip's members**, and to nobody else — resolved reminder → trip → `trip_members` → `push_subscriptions`. Before phase 6 this read every registered device and sent every due reminder to all of them, which leaked reminder titles (free text) across accounts. `subscriptions` counts the distinct devices a run actually addressed, not every device on record.

### GET /api/push/key

- 200: `{"public_key":"B…"}` — the VAPID public key the browser needs in order to subscribe, or `null` when the server has no keys configured (the UI then explains that nothing will be delivered).

### POST /api/push/subscriptions

One row per device, held against the signed-in account (`push_subscriptions.user_id`, migration 0016). Re-subscribing the same endpoint updates its keys **and its owner** — a push endpoint identifies a device, not a person, so it follows whoever is signed in on it. The app re-posts an existing subscription on load for exactly that reason.

- Request: `{"endpoint":"https://…","p256dh":"…","auth":"…","label?":"iPhone"}`
- 201: `{"subscription":{"id":"…","label":"iPhone"}}` — the endpoint is not echoed back · 400 `VALIDATION` · 403 for the deprecated access codes, which are a right rather than an identity and so have no devices · 503 when the server has no VAPID keys.

### DELETE /api/push/subscriptions?endpoint=…

Your own devices only. Someone else's endpoint answers 404, the same as one that was never registered.

- 204 · 400 (missing endpoint) · 403 (access code) · 404.

### POST /api/push/test

Sends "notifications are working" to the caller's own devices, and nobody else's.

- 200: `{"subscriptions":1,"sent":1,"failed":0}` · 403 (access code) · 503 when unconfigured.

## Export (feature 003)

One projection of the trip at one of two detail levels, returned as JSON. The bytes of the actual file are
produced **on the device** — there is no route that returns a PDF, no temporary storage, no signed link and
nothing to expire. See [`specs/003-trip-export/`](../../003-trip-export/) for the field policy this is built
on (`server/src/lib/export-view.ts`), which is where a field is admitted to an export in the first place.

### GET /api/trips/:tripId/export?detail=share|full

Read-only and deterministic: the same trip at the same detail always returns the same content (SC-006).
Nothing in it is generated, inferred, summarised or reworded (FR-006).

Mounted on the trip-scoped router, so `requireTripAccess` applies by construction — a trip the caller is not
a member of answers **404, never 403**. **Any member may call it, viewers included** (FR-007): the response
is a strict subset of what that member can already read on the other routes.

- `detail` is required. Absent, empty or anything but `share`/`full` → 400; it is not defaulted, because
  which version you are exporting is never something the server should guess.
- `ids` is optional (`ids=1`). Off by default, and the default is what the shapes below describe. With it,
  every place additionally carries its `id` and `zone_id` — the only fields the field policy marks `json`,
  and the only thing the machine-readable backup needs that a readable file must never show. It widens
  nothing else: a share payload with `ids=1` still carries exactly the share fields plus those two. The app
  asks for it on every fetch so that one cached payload can serve all four writers offline; the readable
  writers render an outline that has no way to reach an id.

- 200 (share): `{"export":{"detail":"share","generated_at":"2026-08-28T12:00:00.000Z","trip":{"title":"Japan","start_date":"2026-11-01","end_date":"2026-11-14","country":"Japan"},"steps":[{"start_date":"2026-11-01","end_date":"2026-11-05","zone":{"name":"Tokyo","places":[{"name":"Kagari Ginza","address":"6-4-12 Ginza, Chuo City","category":"food"}]}}],"days":[],"stats":{"place_count":39,"places_without_address":2,"day_count":0,"included_stays":true}}}`
- 200 (full): the same envelope plus, per place, `description` and `links`; per place and zone, `tips`; per
  zone, `summary`; the trip's `description`; and a populated `days` array (`day_count` counts the days
  carrying at least one item).
- 400 `VALIDATION` — `details: ["detail must be \"share\" or \"full\""]` · 401 `UNAUTHORIZED` · 404
  `NOT_FOUND` (no such trip, **or** the caller is not a member of it).

**Absent, not null.** Optional keys are omitted at share detail rather than sent empty, so a share payload
carries no container a writer could render as a labelled, empty section. `address` is the exception: it is
always present, empty where the place has none, and `stats.places_without_address` is what reports the gap
(FR-018) rather than a run of blank rows.

**What is in neither version (FR-004a).** No flight details, no shopping item, no document and no member or
traveller name — for _every_ caller, an owner with the unrestricted view included. These are not filtered
out per caller; they are not part of the projection at all, so a full copy forwarded to the wrong person
still leaks no booking reference and no present. The trip's `title` is derived without falling back to
member names for the same reason.

**The caller's view, applied first (FR-008).** The exporting member's `TripView` is applied _before_ the
field policy — reversed, a hidden stay would be cut down to a name and an address and then exported. For a
viewer without `can_see_stays`: no `hotel` place in any zone, no tip hanging off one, no day-plan row
linking to one (the row survives, its link does not), and the stay is out of `stats.place_count`.
`stats.included_stays` is `false` — the one place the response admits a view was applied at all, and a
property of the export rather than a hint about any particular place. Nothing states what was withheld.

**Caching.** An ordinary `GET` under `/api`, so the service worker's `NetworkFirst` rule applies: fresh when
online, last known when not. No `Cache-Control` beyond the app default and no ETag — the payload is small
and always cheap to rebuild. Offline export therefore depends on the payload having been fetched once, which
is what the trip home's background prefetch is for.

## Ops

### GET /api/health

No auth. Performs one trivial DB read (keep-alive target for the daily Vercel cron, research R3).

- 200: `{"ok":true}` · 500 `INTERNAL` if DB unreachable.

## Contract tests (per route group, see plan Testing)

Each route: happy path, 401 without/with-wrong bearer, 400 validation cases, 404 unknown id. Files: both 404 variants. Trip: counts match seeded data.
