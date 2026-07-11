# Data Model: Japan Trip Companion App

**Date**: 2026-07-11 | **Plan**: [plan.md](plan.md) | **Store**: Supabase Postgres (schema in `supabase/migrations/`)

All tables use `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz default now()` (trigger-maintained). Row Level Security: **deny-all for `anon` and `authenticated`** on every table — data is reachable only through the backend's service-role client.

## Entity relationship overview

```text
trips 1 ──── * journey_steps * ──── 1 zones
trips 1 ──── * files (trip-level)          zones 1 ──── * places
zones 1 ──── * tips (zone-level)           places 1 ──── * tips (place-level)
zones 1 ──── * files (zone-level)          places 1 ──── * files (place-level)
```

## trips

The single overall journey (the schema supports several, the app loads one).

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| name | text | required, 1–120 chars |
| start_date | date | required |
| end_date | date | required, ≥ start_date |
| description | text | optional |

## journey_steps

Ordered stops of the trip (FR-001, FR-005).

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| trip_id | uuid FK → trips | required, on delete cascade |
| zone_id | uuid FK → zones | required — exactly one zone per step |
| position | int | required, unique per trip (`unique(trip_id, position)`) |
| start_date | date | required |
| end_date | date | required, ≥ start_date |

Derived (not stored): a step is **current** when device date ∈ [start_date, end_date]; **past**/**future** otherwise. If trip dates entirely past/future, no step is current (edge case in spec).

## zones

City or area grouping content (FR-002).

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| name | text | required, 1–80 chars (e.g., "Tokyo") |
| name_ja | text | optional Japanese name (e.g., "東京") — decorative per design language |
| summary | text | optional |
| image_url | text | optional http(s) photo URL (added 2026-07-11: booking-style visual cards); UI falls back to a styled block when absent/unloadable |

## places

Points of interest (FR-002, FR-003, FR-015).

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| zone_id | uuid FK → zones | required, on delete cascade |
| category | text enum | required: `hotel` \| `attraction` \| `food` (restaurants & cafes) \| `shopping` \| `other` |
| name | text | required, 1–120 chars |
| name_ja | text | optional Japanese name |
| description | text | optional (notes) |
| address | text | optional address / location reference |
| links | jsonb | optional array of `{label, url}`; urls must be http(s) |
| image_url | text | optional http(s) photo URL (added 2026-07-11); editable in the place form |

Index: `(zone_id, category)` — the primary browse query (FR-002, SC-001).

State transitions: created → edited (any field) → deleted (hard delete; requires UI confirmation per FR-017; cascades to its tips and detaches its files' association — see files note).

## tips

Advice attached to a zone OR a place — exactly one parent (FR-004, FR-016).

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| zone_id | uuid FK → zones, nullable | on delete cascade |
| place_id | uuid FK → places, nullable | on delete cascade |
| body | text | required, 1–1000 chars |

Constraint: `check (num_nonnulls(zone_id, place_id) = 1)` — a tip belongs to exactly one of zone/place.

## files

Metadata for pre-collected files stored in the Supabase Storage bucket `trip-files` (FR-007, FR-008). Attached to trip, zone, OR place — exactly one parent.

| Field | Type | Rules |
|---|---|---|
| id | uuid PK | |
| trip_id | uuid FK → trips, nullable | on delete cascade |
| zone_id | uuid FK → zones, nullable | on delete cascade |
| place_id | uuid FK → places, nullable | on delete set null → reattached as trip-level* |
| display_name | text | required, 1–120 chars (recognizable name per US4 AC1) |
| storage_path | text | required, unique — object key in bucket `trip-files` |
| mime_type | text | required (drives type icon / open behavior) |
| size_bytes | bigint | required (shown in listing; budget awareness) |

Constraint: `check (num_nonnulls(trip_id, zone_id, place_id) = 1)`.

\* Deleting a place must not silently destroy an uploaded document (spec edge case: no silent data loss). Implementation: before place delete, backend re-parents its files to the trip (`place_id → null, trip_id → trip`). Blobs themselves are only removed by the (out-of-app) seed/admin tooling.

Missing-blob edge case (spec): if signed-URL generation fails because the object is gone, the API returns 404 `FILE_MISSING` and the UI shows a clear error, not a blank screen (FR-013).

## Validation summary (enforced in backend, mirrored in DB where cheap)

- Required fields and length caps as tabled above; reject unknown `category` values (400).
- Date ordering on trips and journey_steps (400 on violation).
- Tips/files parent exclusivity (DB check constraints; 400 before hitting DB).
- Last-write-wins on concurrent edits (spec edge case) — no version column; `updated_at` reflects the winner.
