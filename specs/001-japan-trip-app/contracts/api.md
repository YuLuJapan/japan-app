# API Contract: Japan Trip Companion App

**Date**: 2026-07-11 | **Plan**: [plan.md](../plan.md) | **Entities**: [data-model.md](../data-model.md)

Base URL: `/api` (Express app behind one Vercel serverless function). All bodies JSON, UTF-8.

## Conventions

- **Auth**: every route except `GET /api/health` requires `Authorization: Bearer <ACCESS_CODE>` where `ACCESS_CODE` is the shared code (env `TRIP_ACCESS_CODE`). Missing/wrong → `401 {"error":{"code":"UNAUTHORIZED"}}`.
- **Error envelope**: `{"error":{"code":"<MACHINE_CODE>","message":"<human text>"}}`. Codes: `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION` (400, with `details` array), `FILE_MISSING` (404), `INTERNAL` (500).
- **IDs** are UUID strings. Timestamps ISO-8601. Dates `YYYY-MM-DD`.
- Successful `DELETE` → `204` no body.
- **2026-07-11 addition**: zones and places carry an optional `image_url` (http(s) photo). It appears in zone summaries (GET /api/trip), zone detail, place list items, and place detail; accepted on place POST/PATCH (validated as http(s) URL).

## Auth

### POST /api/auth/verify
Validates the access code entered on the gate screen (the code itself is then used as the bearer token).

- Request: `{"code": "string"}`
- 200: `{"ok": true}` · 401 on wrong code.

## Trip & journey

### GET /api/trip
The whole journey skeleton in one call — powers the Journey (home) view and offline-ish caching (one query serves SC-002/SC-006).

- 200:
```json
{
  "trip": {"id":"…","name":"Japan 2026","start_date":"2026-10-05","end_date":"2026-10-24","description":"…"},
  "steps": [
    {"id":"…","position":1,"start_date":"2026-10-05","end_date":"2026-10-10",
     "zone": {"id":"…","name":"Tokyo","name_ja":"東京","summary":"…",
              "place_counts": {"hotel":1,"attraction":8,"food":6,"shopping":3,"other":2}}}
  ],
  "trip_files_count": 4,
  "flight": {
    "airline":"Ethiopian Airlines","booking_ref":"AOXIUF",
    "outbound": {"depart_at":"2026-09-18T15:35:00+03:00","depart_tz":"Asia/Jerusalem",
                 "arrive_at":"2026-09-19T19:40:00+09:00","arrive_tz":"Asia/Tokyo",
                 "legs":[{"flight_no":"ET 419","from":"Tel Aviv (TLV)","to":"Addis Ababa (ADD)"}]},
    "return_flight": {"depart_at":"2026-10-16T20:40:00+09:00","depart_tz":"Asia/Tokyo",
                      "arrive_at":"2026-10-17T14:35:00+03:00","arrive_tz":"Asia/Jerusalem",
                      "legs":[{"flight_no":"ET 673","from":"Narita (NRT)","to":"Addis Ababa (ADD)"}]}
  }
}
```
- Current/past/future step status is **computed client-side** from device date (FR-006).
- `flight` is trip-level metadata held in code (`server/src/lib/flight.ts`), not the DB, so the booking reference is only served behind auth. `outbound.depart_at` is the countdown target; the `*_tz` fields are IANA zones so ticket times render the same on a phone set to Israel or to Japan.

## Journey steps

Self-service editing of the trip schedule (which destinations, over what dates). Steps carry no client-controlled order — `GET /api/trip` always returns them **sorted by `start_date`**, so a destination added with an earlier date automatically appears earlier in the list. `position` is an internal bookkeeping field (assigned on create, never patched) and is not meaningful to clients.

A destination is given either as an existing `zone_id` or as free-text `destination` (the name + coordinates of a real place, e.g. from a geocoder-backed autocomplete on the client — see `GET /api/geocode`). Exactly one of the two is required on create. When `destination` is given, the server reuses an existing zone whose name matches (case-insensitive); otherwise it creates a new zone from the destination's name/lat/lng.

### POST /api/steps
- Request: `{"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","zone_id":"…"} | {"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","destination":{"name":"…","address?":"…","lat":n,"lng":n}}`
- 201: `{"step": {"id":"…","trip_id":"…","zone_id":"…","position":n,"start_date":"…","end_date":"…"}}` · 400 `VALIDATION` (missing zone_id/destination, bad dates, end before start, bad destination name/lat/lng) · 404 unknown zone (when `zone_id` given).

### PATCH /api/steps/:stepId
- Request: any subset of `{"zone_id","destination","start_date","end_date"}`. Dates are cross-checked against the merged (existing + patched) values, so patching just one date still enforces end ≥ start.
- 200: `{"step": {…updated…}}` · 400 `VALIDATION` · 404 unknown step or zone.

### DELETE /api/steps/:stepId
- 204 · 404.

## Zones

### GET /api/zones/:zoneId
Zone header + zone-level tips + zone-level files + per-category counts (drives category visibility, FR-012).

- 200:
```json
{
  "zone": {"id":"…","name":"Kyoto","name_ja":"京都","summary":"…"},
  "tips": [{"id":"…","body":"Buy the bus day pass at…"}],
  "files": [{"id":"…","display_name":"Kyoto walking map","mime_type":"application/pdf","size_bytes":123456}],
  "place_counts": {"hotel":1,"attraction":5,"food":4,"shopping":0,"other":1}
}
```
- 404 `NOT_FOUND` for unknown id.

### GET /api/zones/:zoneId/places?category=food
Places of one category in a zone, list form (name + summary line, FR-002).

- `category` required, one of `hotel|attraction|food|shopping|other` → else 400 `VALIDATION`.
- 200: `{"places":[{"id":"…","name":"…","name_ja":"…","category":"food","summary_line":"first ~100 chars of description"}]}` (may be empty — UI renders empty state, FR-012).

## Itinerary (day-by-day activities)

A flat list of timed/untimed activities per trip; the client groups them by day. Distinct from journey steps above — an itinerary item is a single activity within a day, optionally linked to a saved place.

### GET /api/itinerary
- 200: `{"items":[{"id":"…","trip_id":"…","zone_id":"…","place_id":"…","day":"YYYY-MM-DD","start_time":"HH:MM"|null,"title":"…","note":"…"|null,"position":0,"highlight":false,"icon":"…"|null}]}`

### POST /api/itinerary
- Request: `{"day":"YYYY-MM-DD","title":"…","zone_id?","place_id?","start_time?":"HH:MM","note?","position?","highlight?","icon?"}`
- 201: `{"item": {…}}` · 400 `VALIDATION` (missing title/bad day/bad time) · 404 unknown zone.

### PATCH /api/itinerary/:itemId
- Request: any subset of the POST fields. Last write wins.
- 200: `{"item": {…updated…}}` · 400 · 404.

### DELETE /api/itinerary/:itemId
- 204 · 404.

## Places

### GET /api/places/:placeId
Full detail incl. tips and files (US1 AC2/AC3, US4 AC1).

- 200:
```json
{
  "place": {"id":"…","zone_id":"…","category":"food","name":"…","name_ja":"…",
            "description":"…","address":"…","links":[{"label":"Tabelog","url":"https://…"}]},
  "tips": [{"id":"…","body":"…"}],
  "files": [{"id":"…","display_name":"…","mime_type":"…","size_bytes":123}]
}
```

### POST /api/places  (FR-015, SC-008)
- Request: `{"zone_id":"…","category":"food","name":"…","name_ja?":"…","description?":"…","address?":"…","links?":[…]}`
- 201: `{"place": {…full place…}}` · 400 `VALIDATION` (missing name/zone/bad category) · 404 unknown zone.

### PATCH /api/places/:placeId  (FR-015)
- Request: any subset of the POST fields. Last write wins.
- 200: `{"place": {…updated…}}` · 404 · 400.

### DELETE /api/places/:placeId  (FR-015, FR-017)
- Confirmation is a UI concern; the API deletes immediately. Place's tips cascade; its files are re-parented to the trip (see data-model note — no silent file loss).
- 204 · 404.

## Tips

### POST /api/tips  (FR-016)
- Request: `{"body":"…","zone_id":"…"} | {"body":"…","place_id":"…"}` — exactly one parent, else 400.
- 201: `{"tip":{…}}`.

### PATCH /api/tips/:tipId
- Request: `{"body":"…"}` → 200 `{"tip":{…}}` · 404.

### DELETE /api/tips/:tipId  (FR-017)
- 204 · 404.

## Shopping list

Trip-level list of things to buy in Japan: what it is, where to buy it, what it should cost (yen), a photo, and whether it's been bought. Not tied to a zone, though an item may name the city its shop is in (`zone_id`). `category` is one of `clothes|beauty|tech|snacks|home|souvenir|other` (defaults to `other`).

### GET /api/shopping
- 200: `{"items":[{"id":"…","trip_id":"…","name":"Onitsuka Tiger Mexico 66","category":"clothes","note":"Size 42"|null,"shop":"ABC Mart"|null,"zone_id":"…"|null,"price_yen":12000|null,"url":"https://…"|null,"image_url":"https://…"|null,"bought":false,"position":0}]}`
- Ordered **unbought first**, then `position`, then insertion order — bought items sink to the bottom of the list.

### POST /api/shopping
- Request: `{"name":"…","category?":"clothes","note?","shop?","zone_id?","price_yen?":12000,"url?","image_url?","bought?":false}`
- 201: `{"item": {…}}` · 400 `VALIDATION` (missing name, unknown category, negative/non-numeric `price_yen`, non-http(s) `url`/`image_url`) · 404 unknown zone.

### PATCH /api/shopping/:itemId
- Request: any subset of the POST fields — `{"bought": true}` is the tick-off action. Last write wins.
- 200: `{"item": {…updated…}}` · 400 · 404.

### DELETE /api/shopping/:itemId
- 204 · 404.

## Files

### GET /api/files
Trip-level files (US4 AC3).

- 200: `{"files":[{"id":"…","display_name":"…","mime_type":"…","size_bytes":123}]}`

### GET /api/files/:fileId/url  (FR-008)
Short-lived signed URL for opening/downloading the blob.

- 200: `{"url":"https://…signed…","expires_in":300}`
- 404 `NOT_FOUND` (no such row) · 404 `FILE_MISSING` (row exists, blob gone — spec edge case, distinct code so the UI can explain).

### GET /api/files/:fileId/content  (FR-008)
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
