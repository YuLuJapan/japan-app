# Phase 1 Data Model: Map

**There is no migration in this feature.** Every column it needs already exists. What follows is what is already stored, what is derived in memory, and the one rule that keeps a derived shape from quietly widening.

---

## Stored entities (unchanged)

### `Place` — `server/src/lib/datastore.ts`

| Field         | Type                                                         | This feature                                                                    |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `id`          | string                                                       | pin identity; the link back to the place screen                                 |
| `zone_id`     | string                                                       | which zone map the place belongs on                                             |
| `category`    | `'hotel' \| 'attraction' \| 'food' \| 'shopping' \| 'other'` | pin styling, the filter chips, and the withheld category                        |
| `name`        | string                                                       | pin label, sheet title                                                          |
| `name_ja`     | string \| null                                               | shown in the sheet as it is elsewhere                                           |
| `description` | string \| null                                               | **never on a pin** — reaches the sheet only as the derived `summary_line`       |
| `address`     | string \| null                                               | sheet, and the input to geocoding                                               |
| `links`       | `PlaceLink[]`                                                | not on the map                                                                  |
| `image_url`   | string \| null                                               | not on the map                                                                  |
| `lat`         | number \| null                                               | **filled by this feature.** 0 of 39 today. Validated −90…90 on write, already   |
| `lng`         | number \| null                                               | **filled by this feature.** 0 of 39 today. Validated −180…180 on write, already |

A place with `lat` or `lng` null is not an error and not hidden: it is counted and listed (FR-019).

### `Zone` — `server/src/lib/datastore.ts`

`id`, `trip_id`, `name`, `name_ja`, `summary`, `image_url`, `lat`, `lng`. All 9 zones already carry correct coordinates, which is why the whole-trip scale works before the backfill runs and why every place search can be biased toward the right city.

### `JourneyStep`

`id`, `position`, `start_date`, `end_date`, `zone_id`. Decides which zone the map opens on; supplies the whole-trip scale's pins through the zone it points at. Read from the trip bundle, which already carries all of it.

### `TripMember` → `TripView`

`can_see_stays` / `can_see_flight` / `can_see_documents` / `can_see_shopping` collapse into a `TripView` on the request context (`server/src/lib/trip-view.ts`). Only `stays` bears on the map, and it is applied where it already is — inside `listZonePlaces`, before the response is built.

---

## Derived shapes (in memory; nothing persisted)

### `MapPin` — `src/map/pins.ts`

What the engine draws. Deliberately narrower than a place: everything else belongs to the sheet, which reads the place the list already gave it.

```text
MapPin {
  id: string
  name: string
  category: Category
  lat: number          // never null — a pin cannot exist without one
  lng: number
}
```

The non-null coordinates are the invariant that makes the missing-count honest: `toPins(places)` returns pins for the located ones and `missingCount(places)` counts the rest, and the two are built from the same array in the same pass, so `pins.length + missing === places.length` cannot drift (SC-004).

### `MapScope` — `src/map/scope.ts`

Both scales produce one shape, so the page renders without knowing which it has (research R6):

```text
MapScope {
  kind: 'zone' | 'trip'
  pins: MapPin[]
  bounds: Bounds | null       // null when there is nothing to frame
  emptyMessage: string
  onPinTap: (id: string) => void
}
```

`zoneScope` builds pins from that zone's places; `tripScope` builds one pin per zone from the bundle's steps, and its `onPinTap` switches the page to `zoneScope`.

### `PositionState` — `src/lib/geolocation.ts`

Permission as data rather than as exceptions, so every branch of FR-022 to FR-025 is a rendered case:

```text
PositionState =
  | { status: 'idle' }          // not asked — the state on mount (FR-023)
  | { status: 'asking' }
  | { status: 'granted', lat, lng, accuracy }
  | { status: 'denied' }        // refused, or refused by policy
  | { status: 'unavailable' }   // no sensor, timeout, insecure context
```

`denied` and `unavailable` are separate because the traveller can act on one and not the other.

---

## The one rule with teeth: the field policy

`src/map/pins.ts` narrows a place to a pin, but the narrowing that matters happens earlier, on the wire. `listZonePlaces` builds its response from an explicit list of fields — which is right, and silent: adding a column to `Place` leaves that literal valid, and nothing tells the next person to decide about it.

Slice B moves that literal into `zonePlaceListItem()` in `server/src/lib/place-view.ts`, driven by:

```text
Record<keyof Place, 'list' | 'omit'>
```

Adding a column to `Place` then fails `npm run typecheck` until someone writes `'list'` or `'omit'` next to it. This is the pattern `server/src/lib/export-view.ts` established in feature 003, applied to the second projection that leaves the server carrying place data.

Today's policy:

| `'list'`                                                                                                    | `'omit'`                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`, `name`, `name_ja`, `category`, `address`, `image_url`, `lat`, `lng` (plus the derived `summary_line`) | `description` (the summary line is the sanctioned form), `links`, `zone_id` (the caller asked for this zone) |

---

## What is not on the map, and why it is not a filter

Nothing about the flight, the shopping list, the documents or any member reaches this feature. There is no code that removes them, because there is no code that adds them — the map reads places and zones. Stays are the exception that needs enforcing, and are enforced one layer down, in `listZonePlaces`, for every caller: a member whose view withholds stays receives no hotel row at all, so there is no hotel to pin and nothing to filter client-side.

That is the ordering the spec insists on (FR-016): the withholding happens to what is transmitted, and the absent chip is only courtesy.
