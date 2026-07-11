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
  "trip_files_count": 4
}
```
- Current/past/future step status is **computed client-side** from device date (FR-006).

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

## Files

### GET /api/files
Trip-level files (US4 AC3).

- 200: `{"files":[{"id":"…","display_name":"…","mime_type":"…","size_bytes":123}]}`

### GET /api/files/:fileId/url  (FR-008)
Short-lived signed URL for opening/downloading the blob.

- 200: `{"url":"https://…signed…","expires_in":300}`
- 404 `NOT_FOUND` (no such row) · 404 `FILE_MISSING` (row exists, blob gone — spec edge case, distinct code so the UI can explain).

## Ops

### GET /api/health
No auth. Performs one trivial DB read (keep-alive target for the daily Vercel cron, research R3).

- 200: `{"ok":true}` · 500 `INTERNAL` if DB unreachable.

## Contract tests (per route group, see plan Testing)

Each route: happy path, 401 without/with-wrong bearer, 400 validation cases, 404 unknown id. Files: both 404 variants. Trip: counts match seeded data.
