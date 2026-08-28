# API Contract: Export the Trip (feature 003)

**Date**: 2026-08-28 | **Plan**: [plan.md](../plan.md) | **Model**: [data-model.md](../data-model.md)

Conventions, auth and the error envelope are unchanged — see
[`specs/001-japan-trip-app/contracts/api.md`](../../001-japan-trip-app/contracts/api.md). **That file is the
source of truth for the API; this one is the working draft for the endpoint, and its content is merged into
it as part of implementation** (task T015). One route is added; nothing existing changes.

---

## GET /api/trips/:tripId/export?detail=share|full

Returns the trip projected to one detail level. Read-only, no side effects, no model involved — the same
trip at the same detail always returns the same content (SC-006).

Mounted on the trip-scoped router, so `requireTripAccess` applies by construction: a trip the caller is not a
member of answers **404**, never 403. **Any member may call it, viewers included** (FR-007) — there is no
role check, because the response is a strict subset of what the caller can already read on the other routes.

### Query parameters

| name | required | values | notes |
| --- | --- | --- | --- |
| `detail` | yes | `share` \| `full` | anything else → `400 VALIDATION`. Absent → `400`, not a default: which version you are exporting is never something the server should guess. |

### 200 — share detail

```json
{
  "export": {
    "detail": "share",
    "generated_at": "2026-08-28T12:00:00.000Z",
    "trip": { "title": "Japan", "start_date": "2026-11-01", "end_date": "2026-11-14", "country": "Japan" },
    "steps": [
      {
        "start_date": "2026-11-01",
        "end_date": "2026-11-05",
        "zone": {
          "name": "Tokyo",
          "places": [
            { "name": "Kagari Ginza", "address": "6-4-12 Ginza, Chuo City", "category": "food" },
            { "name": "teamLab Borderless", "address": "", "category": "attraction" }
          ]
        }
      }
    ],
    "days": [],
    "stats": { "place_count": 39, "places_without_address": 2, "day_count": 0, "included_stays": true }
  }
}
```

Note what is **absent** rather than null: no `description`, no `links`, no `tips`, no `summary_line`, no
`id`. A share payload carries no key that a writer could render as an empty section.

### 200 — full detail

Same envelope, plus per place `description` and `links`, per place and zone `tips`, per zone `summary`, the
trip's `description`, and a populated `days` array. `day_count` is the number of days carrying at least one
item.

At **both** levels, and for every caller including an owner with the unrestricted view, the response contains
no `flight`, no shopping item, no document and no member (**FR-004a**). Those are not filtered out per
caller — they are not part of the projection at all.

### The caller's view (FR-008)

The response is filtered by the caller's `TripView` *before* the field projection. For a viewer without
`can_see_stays`: no `hotel` place appears in any zone, no tip hanging off one appears, no itinerary item
links to one, and the stay does not contribute to `stats.place_count`. `included_stays` is `false`, which is
the one place the response admits a view was applied — it is a property of the export, not a hint about any
particular place.

### Errors

| status | code | when |
| --- | --- | --- |
| 400 | `VALIDATION` | `detail` missing or not `share`/`full`. `details: ["detail must be \"share\" or \"full\""]` |
| 401 | `UNAUTHORIZED` | no bearer token, or it does not verify |
| 404 | `NOT_FOUND` | the trip does not exist, **or** the caller is not a member of it |

There is no 403 on this route. A member who lacks a verb never reaches it, because there is no verb here —
every member may read, and every member may export.

### Caching

An ordinary `GET` under `/api`, so the service worker's `NetworkFirst` rule applies: fresh when online, last
known when not. No `Cache-Control` beyond the app default, and no ETag — the payload is small and always
cheap to rebuild. Offline behaviour depends on the payload having been fetched once, which is what the trip
home's background prefetch is for (research R4).

---

## Not added

No `POST`, and no server-rendered file. The bytes are produced on the device (research R1), so there is no
route that returns a PDF, no temporary storage, no signed link and nothing to expire.
