# API delta: Separate pages for repeated cities

**Source of truth** is `specs/001-japan-trip-app/contracts/api.md`; this file is the change set to fold into it when the feature lands. Every route below is already mounted under `/api/trips/:tripId` behind `requireTripAccess`, so all of it is access-checked by construction — no new access surface.

## 1. `GET /trips/:tripId/zones/:zoneId` — a `visit` block is added

The zone page needs its own dates and its siblings to label itself and to offer the move (R6). Nothing is removed.

```jsonc
{
  "zone": { "...": "unchanged", "city_key": "tokyo" },
  "tips": [],
  "files": [],
  "place_counts": {},

  // NEW. Always present; describes this zone's place in its city.
  "visit": {
    "step_id": "step-0",          // null when the visit is no longer on the journey (R8)
    "start_date": "2026-09-19",   // null with no step
    "end_date": "2026-09-25",     // null with no step
    "ordinal": 1,                 // 1-based among siblings, by start_date then position
    "total": 2,                   // siblings including this one; 1 means "not a repeated city"
    "siblings": [                 // the other visits, for the move picker. Empty when total is 1.
      { "zone_id": "zone-tokyo-2", "start_date": "2026-10-12", "end_date": "2026-10-16", "ordinal": 2 }
    ]
  }
}
```

**`total: 1` is the whole of FR-003.** A city visited once returns one sibling-free block, the client renders no label, no chooser and no move action, and the page is byte-for-byte what it was.

## 2. `PATCH /trips/:tripId/places/:placeId` — `zone_id` becomes writable

Also `PATCH /tips/:tipId` and `PATCH /files/:fileId`. Absent means "leave it alone", as everywhere else.

```jsonc
{ "zone_id": "zone-tokyo-2" }
```

**Validation** (all `400 VALIDATION`, errors collected into one `details` array per the service convention):

| Condition | Message |
| --- | --- |
| Zone not on this trip | `zone_id must be a zone on this trip` |
| Zone has a different `city_key` | `zone_id must be another visit of the same city` |
| Zone is the current one | _no error — a no-op move succeeds_ |

**Response**: the moved row in its list's shape — a place comes back through `lib/place-view.ts` with its `summary_line`, exactly as every other write answers.

### FR-010: a move that would strand a day-plan link

If the place is linked to itinerary items on days outside the destination visit, the move is **refused** rather than silently breaking the day plan:

```jsonc
// 400
{
  "error": {
    "code": "VALIDATION",
    "message": "Moving this place would leave activities pointing at another visit",
    "details": ["3 activities on 20–22 Sep link to this place"],
    "stranded": [{ "id": "item-12", "day": "2026-09-20", "title": "Senso-ji at dawn" }]
  }
}
```

Retry with `{ "zone_id": "...", "stranded_items": "move" }` to bring the activities along, or `"leave"` to unlink them. Deliberately mirrors `GET /trips/:id/date-impact` + `stranded_stops`, which is how the app already asks this question.

## 3. `POST /trips/:tripId/steps` — a destination no longer reuses a zone

**Behaviour change, no shape change.** `{ "destination": { "name": "Tokyo", … } }` now always creates a new zone, where it previously reused any zone whose name matched (FR-006).

`zone_id` keeps meaning "this exact visit", and gains one validation:

| Condition | Status | Message |
| --- | --- | --- |
| That zone already has a step | `400 VALIDATION` | `zone_id already belongs to another stop — add a destination to visit it again` |

This is what stops the old pooling being recreated through the back door.

## 4. `DELETE /trips/:tripId/steps/:stepId` — unchanged, documented

The step goes; **its zone and everything in it stay** (FR-011, R8). The zone becomes reachable from search and the trip's file list but not from the journey. No cascade — nothing in this app deletes content because a date changed.

## 5. Read-only shapes that gain a field

- **`GET /trips/:tripId` (bundle)**: each step's nested zone carries `city_key`, so the client can group visits without a second call. `stepView` already assembles this.
- **`GET /trips/:tripId/search`**: a zone result's `subtitle` becomes the visit label instead of the constant `'Zone'` for a repeated city; a place result's subtitle gains its visit (FR-016). `href` is unchanged — `/zones/:id` already addresses one visit.
- **`GET /trips/:tripId/export`**: each step projects its own zone's places, which is already the loop; the `counted` dedup Set is **deleted** (R1). A repeated city yields two sections in journey order and no content appears twice (FR-018). No field-policy entry changes: `city_key` is a `Zone` field, and `ZONE_FIELD_POLICY` classifies it `'never'` — it is plumbing, not trip content.

## Unchanged, and worth stating

- `GET /zones/:zoneId/places` — already per-zone, therefore already per-visit.
- Every visibility rule. A member who cannot see stays sees no stays and no stay counts **on each visit**; the split must not let a total be differenced against a per-visit count to infer a hidden booking (FR-020, SC-007).
- Shopping, flight, reminders and trip-level documents: all trip-level, none divided.
