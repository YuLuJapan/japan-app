# API Contract: Japan Trip Companion App

**Date**: 2026-07-11 | **Plan**: [plan.md](../plan.md) | **Entities**: [data-model.md](../data-model.md)

Base URL: `/api` (Express app behind one Vercel serverless function). All bodies JSON, UTF-8.

## Conventions

- **Auth**: every route except `GET /api/health` requires `Authorization: Bearer <ACCESS_CODE>`. Two codes are accepted, and which one is sent decides the caller's **role**:
  - `TRIP_ACCESS_CODE` → role `owner` — the travelers, full read/write.
  - `TRIP_GUEST_CODE` (optional; unset = no guest view) → role `guest` — read-only, and no documents at all.

  Missing/wrong → `401 {"error":{"code":"UNAUTHORIZED"}}`. If both env vars hold the same value, `owner` wins.

- **Guest restrictions** (enforced in `authMiddleware`, before any route runs):
  - any method other than `GET`/`HEAD`/`OPTIONS` → `403 {"error":{"code":"FORBIDDEN"}}`;
  - any path under `/api/files` → `403 FORBIDDEN`, reads included;
  - `GET /api/zones/:zoneId` and `GET /api/places/:placeId` still answer `200`, but their `files` array is always `[]`.
- **Error envelope**: `{"error":{"code":"<MACHINE_CODE>","message":"<human text>"}}`. Codes: `UNAUTHORIZED`, `FORBIDDEN` (403), `NOT_FOUND`, `VALIDATION` (400, with `details` array), `FILE_MISSING` (404), `INTERNAL` (500).
- **IDs** are UUID strings. Timestamps ISO-8601. Dates `YYYY-MM-DD`.
- Successful `DELETE` → `204` no body.
- **2026-07-11 addition**: zones and places carry an optional `image_url` (http(s) photo). It appears in zone summaries (GET /api/trip), zone detail, place list items, and place detail; accepted on place POST/PATCH (validated as http(s) URL).

## Auth

### POST /api/auth/verify

Validates the access code entered on the gate screen (the code itself is then used as the bearer token) and reports which view it buys.

- Request: `{"code": "string"}`
- 200: `{"ok": true, "role": "owner" | "guest"}` · 401 on wrong code.

### GET /api/auth/session

The role of the code this client is already holding. Lets a session that predates the guest view learn what it is without being sent back to the gate.

- 200: `{"role": "owner" | "guest"}` · 401 when the stored code is no longer valid.

## Trip & journey

**Multi-trip (2026-08-08 addition):** the app now supports more than one trip — `GET /api/trips` lists them, `POST /api/trips` creates one, and `GET/PATCH/DELETE /api/trips/:tripId` operate on a specific trip. `people` is a free-text array of travellers on the trip itself (not linked accounts — there is no per-trip membership/sharing model, login, or delivered email; `email` is optional and only ever used client-side to open a `mailto:` invite). `GET /api/trip` (singular, no id) is kept as a **legacy alias** for `GET /api/trips/:tripId` on whichever trip is oldest, so the pre-multi-trip UI keeps working; new code should call the plural routes. Journey steps, itinerary, shopping, reminders and file upload are **not yet trip-scoped in their routes** — they still operate on that same oldest trip regardless of how many trips exist, until the UI can actually switch between trips (tracked as a follow-up; trip CRUD itself has no such limitation).

**Traveller shape (2026-08-09 addition):** each entry in `people` is `{"name":"…","email?":"…"}`. A plain string is also accepted on write (normalized to `{"name": "…"}`) for backward compatibility with older clients and rows written before this change; the response always uses the object form.

### GET /api/trips

List every trip, oldest first (powers the "Where to next?" trips list).

- 200: `{"trips": [{"id":"…","name":"…","start_date":"…","end_date":"…","description":"…","people":[{"name":"Yuval"},{"name":"Luciana","email":"luciana@example.com"}]}]}`

### POST /api/trips

- Request: `{"name":"…","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","description?":"…","people?":[{"name":"…","email?":"…"} | "…"]}`
- 201: `{"trip": {…}}` · 400 `VALIDATION` (missing/blank name, bad dates, end before start, name/description too long, more than 12 travellers, a traveller missing a name, a traveller name too long, or an `email` that isn't a valid address).

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
    "booking_ref": "AOXIUF",
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

- Current/past/future step status is **computed client-side** from device date (FR-006).
- `flight` is trip-level metadata held in code (`server/src/lib/flight.ts`), not the DB, so the booking reference is only served behind auth. `outbound.depart_at` is the countdown target; the `*_tz` fields are IANA zones so ticket times render the same on a phone set to Israel or to Japan.

### PATCH /api/trips/:tripId

- Request: any subset of `{"name","start_date","end_date","description","people"}`, plus optional `"stranded_activities": "move" | "delete"` and `"stranded_stops": "move"` (see below).
- 200: `{"trip": {…updated…}[, "moved_stops": ["…step ids…"]][, "moved": ["…item ids…"]][, "deleted": ["…item ids…"]]}` · 400 `VALIDATION` · 404 unknown trip.

Changing the dates can strand what is already planned inside the old range — the mirror of the rule steps and itinerary items enforce on the way in: **the trip's dates always contain everything planned on it**. Either kind of conflict is a 400 unless the request says what to do about it:

- `stranded_stops: "move"` re-dates each stranded step to the trip's new `start_date`, keeping its length (`end_date` clipped to the trip's end when the trip is now too short to hold the stay). Several stranded stops therefore land on top of each other and want re-spacing on the journey editor. Deleting a stop is **not** offered here — that rearranges the journey and belongs to the journey editor's own confirmed delete.
- `stranded_activities: "move"` re-dates each stranded item to the new `start_date` (everything else about the activity is untouched); `"delete"` removes them.

Resolving stops from here is what makes a trip's dates movable at all. A step's dates are themselves pinned to its trip, so "fix the stop first, then the dates" is a deadlock: the stop cannot leave the window the trip still has, and the trip cannot leave the window the stop is in. Postponing a trip wholesale is impossible without this.

The response echoes the affected ids; the fields are absent when the change strands nothing. The trip row is written before its stops and activities are moved, and the two halves are not in one transaction (the DataStore has none). If the second half fails, the dates are already correct and re-saving with the same choices retries it.

### GET /api/trips/:tripId/date-impact?start_date=&end_date=

Dry run for the above: what a date change *would* strand, so the client can list it and ask before committing. Either query param may be omitted to keep the trip's current value.

- 200: `{"range":{"start_date","end_date"},"steps":[{"id","start_date","end_date","zone_name"}],"items":[{"id","day","start_time","title","highlight"}]}` — empty arrays mean the change is clean.
- 400 `VALIDATION` (bad date, end before start) · 404 unknown trip.
- Read-only, so guests may call it; the `PATCH` it precedes is owner-only by method.

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

### GET /api/zones/:zoneId/places?category=food

Places of one category in a zone, list form (name + summary line, FR-002).

- `category` required, one of `hotel|attraction|food|shopping|other` → else 400 `VALIDATION`.
- 200: `{"places":[{"id":"…","name":"…","name_ja":"…","category":"food","summary_line":"first ~100 chars of description"}]}` (may be empty — UI renders empty state, FR-012).

## Itinerary (day-by-day activities)

A flat list of timed/untimed activities per trip; the client groups them by day. Distinct from journey steps above — an itinerary item is a single activity within a day, optionally linked to a saved place.

An item's `day` must fall within its trip's own `start_date`/`end_date` — the same rule journey steps follow. Nothing is planned before the trip starts or after it ends.

### GET /api/itinerary

- 200: `{"items":[{"id":"…","trip_id":"…","zone_id":"…","place_id":"…","day":"YYYY-MM-DD","start_time":"HH:MM"|null,"title":"…","note":"…"|null,"position":0,"highlight":false,"icon":"…"|null}]}`

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
- **Prices**: JPY is taken as-is; USD and ILS are converted with `GET /api/rates`; any other currency comes back as `price_yen: null` plus a `price_note` rather than a guess. A price with no stated currency on a Japanese shop is treated as yen.
- **Fetching a URL the client chose is guarded** (this runs inside our own network): http(s) only; hostnames and resolved addresses in loopback/private/link-local ranges are refused (which covers names like `localtest.me` that resolve to `127.0.0.1`, and the `169.254.169.254` cloud-metadata address); redirects are followed manually, max 3, each hop re-checked; 6s timeout; the read stops after 512 KB. Only parsed fields are returned — never the page body.

### GET /api/translate?q=クルーネックT

Japanese → English, for product names read off Japanese shop pages and for anything typed in Japanese. Backed by MyMemory's free keyless endpoint (no account, inside the $0 constraint); results are cached in-process.

- `q` required → else 400 `VALIDATION`.
- 200: `{"text":"…(as given)","is_japanese":true,"translated":"Crew Neck T-Shirt"|null}`
- `translated` is `null` — never an error — when the text isn't Japanese, the service is down or over quota, or it echoed the input back. Callers keep the original in that case.

## Files

### GET /api/files

All documents attached to the (legacy, oldest) trip: files on the trip itself, plus files on any zone/place visited by one of its journey steps (US4 AC3).

- 200: `{"files":[{"id":"…","display_name":"…","mime_type":"…","size_bytes":123}]}`

**Trip-scoped (2026-08-08 addition):** `GET|POST /api/trips/:tripId/files` are the same two routes pointed at a specific trip instead of the legacy default (oldest) trip — same request/response shapes, same guest block (403).

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

### GET /api/push/key

- 200: `{"public_key":"B…"}` — the VAPID public key the browser needs in order to subscribe, or `null` when the server has no keys configured (the UI then explains that nothing will be delivered).

### POST /api/push/subscriptions

One row per device; re-subscribing the same endpoint updates its keys.

- Request: `{"endpoint":"https://…","p256dh":"…","auth":"…","label?":"iPhone"}`
- 201: `{"subscription":{"id":"…","label":"iPhone"}}` — the endpoint is not echoed back · 400 `VALIDATION` · 503 when the server has no VAPID keys.

### DELETE /api/push/subscriptions?endpoint=…

- 204 · 400 (missing endpoint) · 404.

### POST /api/push/test

Sends "notifications are working" to every subscribed device.

- 200: `{"subscriptions":1,"sent":1,"failed":0}` · 503 when unconfigured.

## Ops

### GET /api/health

No auth. Performs one trivial DB read (keep-alive target for the daily Vercel cron, research R3).

- 200: `{"ok":true}` · 500 `INTERNAL` if DB unreachable.

## Contract tests (per route group, see plan Testing)

Each route: happy path, 401 without/with-wrong bearer, 400 validation cases, 404 unknown id. Files: both 404 variants. Trip: counts match seeded data.
