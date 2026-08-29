# Phase 1 Data Model: Separate pages for repeated cities

**Feature**: `specs/010-separate-repeated-cities` | **Date**: 2026-08-29

The shape of the data barely moves. What changes is the **meaning of a zone**: it stops being "a city on this trip" and becomes "one visit to a city on this trip". One new column records which visits are the same city.

## Before / after

```
BEFORE                                AFTER
                                      
trip                                  trip
 └─ step (19–25 Sep) ─┐                └─ step (19–25 Sep) ─→ zone "Tokyo"  city_key=tokyo
 └─ step (12–16 Oct) ─┴→ zone "Tokyo"  └─ step (12–16 Oct) ─→ zone "Tokyo"  city_key=tokyo
                          ├─ 6 places                          ├─ 3 places   ├─ 3 places
                          └─ 2 tips                            └─ 2 tips     └─ 0 tips
```

One zone reached by two steps becomes two zones reached by one step each. Every edge below the zone — places, tips, files, itinerary links — is unchanged in shape and simply hangs off whichever zone the split assigned it to.

## Entities

### Zone _(changed meaning, one new field)_

| Field | Type | Change | Notes |
| --- | --- | --- | --- |
| `id` | uuid | — | |
| `trip_id` | uuid | — | Trip-scoped since migration 0013 |
| `name` | text | — | Two visits of one city start with the same name and may diverge |
| `name_ja` | text? | — | Copied at split |
| `summary` | text? | — | Copied at split |
| `image_url` | text? | — | Copied at split; editable per visit thereafter (FR-014) |
| `lat` / `lng` | float? | — | Copied at split |
| **`city_key`** | **text?** | **NEW** | Which visits are the same city (FR-014a). Set at creation from the normalised destination name; **never** rewritten on rename |

**`city_key` rules**

- Derived once, at zone creation, as the destination name trimmed, lower-cased and whitespace-collapsed.
- Immutable. Renaming a zone does not touch it — that is the whole point (R2).
- Nullable: a zone without one has no siblings and behaves exactly as a single-visit city.
- Scoped by `trip_id`. Two trips both visiting Tokyo share the string but never the trip, and nothing joins across trips.

**Invariant, new**: a zone has **at most one** journey step. Enforced at `POST`/`PATCH /steps` (R3), established for existing data by the split script.
A zone with **zero** steps is legal — it is a visit removed from the journey whose content was kept (FR-011, R8).

### Journey step _(unchanged)_

`id`, `trip_id`, `zone_id`, `position`, `start_date`, `end_date`. No new column: the step already _is_ the visit's dates, and `zone_id` already points at exactly one visit once the invariant above holds.

### Place, Tip, File, Itinerary item _(unchanged)_

All keep `zone_id`. Because a zone is now a visit, `zone_id` means "this visit" without a single read being rewritten — this is the property R1 was chosen for.

The one behavioural change: `zone_id` becomes **writable** on `PATCH` for places, tips and files, to re-parent between siblings (FR-009). It stays validated to a zone on the same trip, and additionally to one sharing the row's current `city_key`.

## Derived, not stored

| Value | Derived from | Used by |
| --- | --- | --- |
| **Visit label** (`19–25 Sep`, `2nd visit`) | The zone's step dates; ordinal among `city_key` siblings ordered by `start_date` then `position` | Zone page, journey, breadcrumbs, search, export, map chips |
| **Has siblings** | Count of zones on the trip sharing `city_key` | Whether any visit affordance renders at all (FR-003) |
| **Movable-to visits** | Siblings minus self | The move picker (FR-009) |

Nothing here is stored, so a stop's date change relabels every surface with no write and no backfill — and a city visited once derives an empty label, which is what makes FR-003 ("unchanged") true by construction rather than by a special case.

## Migration 0023 — `zone_city_key`

> Highest migration on `main` is `0022_itinerary_category.sql`, so this is **0023**. Per CLAUDE.md, committing it is not deploying it: it must be applied to the live Supabase project by hand.

- `ALTER TABLE zones ADD COLUMN city_key text` (nullable).
- Backfill: `city_key = lower(trim(name))` for every existing zone.
- Index on `(trip_id, city_key)` — every sibling lookup is per trip.

The column is added **and backfilled** by the migration; the rows are **split** by the script below, because splitting is a judgement about which stay a place belongs to and needs a dry run, a journal and an undo.

## The split — `npm run split:visits`

Modelled on `scripts/backfill-coords.ts`: dry-run by default, journalled to a file, `--revert` reads that journal back. Run against `server/src/data/placeholder-data.json` **and** Supabase, so the memory backend and production agree.

For each zone with more than one step, keeping the earliest step on the original zone:

1. For each later step, create a sibling zone — `name`, `name_ja`, `summary`, `image_url`, `lat`, `lng`, `city_key` copied — and repoint that step at it.
2. Move each **itinerary item** whose `day` falls inside a later step's range to that step's new zone.
3. Move each **place** to the visit that schedules it, via the items now moved (FR-012); a place scheduled inside more than one visit stays on the earliest (FR-012a).
4. Leave every **tip**, **file** and **unscheduled place** on the earliest visit (FR-012b).
5. Journal every row touched, with its old and new `zone_id`.

**Idempotent**: a zone with one step is skipped, so a second run is a no-op — which is also what makes `--revert` safe to follow with a re-run.

### What it does to the Japan trip

| | Visit 1 (19–25 Sep) | Visit 2 (12–16 Oct) |
| --- | --- | --- |
| Zone | `zone-tokyo` (kept) | new sibling |
| Places | Senso-ji, teamLab, Ramen night _(unscheduled → FR-012b)_ | Hotel Gracery, Shibuya Crossing & Sky, Don Quijote |
| Tips | 2 _(undated → FR-012b)_ | 0 |
| Itinerary items | the 19–24 Sep items | the 12–16 Oct items |

Every one of the 6 places, 2 tips and 80 items is still reachable afterwards (FR-013).
