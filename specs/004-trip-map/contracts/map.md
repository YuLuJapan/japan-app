# Contract: Map

**The source of truth for the API remains `specs/001-japan-trip-app/contracts/api.md`.** This file records what the map feature relies on, and which of it is a guarantee rather than an accident. Where it changes an existing endpoint's documented behaviour, that file is updated in the same commit.

**No new endpoint.** See research R1: the two calls below already carry everything both scales need, and the payload does not argue for a third.

---

## 1. Zone places — the zone map's pins

```
GET /api/trips/:tripId/zones/:zoneId/places?category=
```

Mounted under `/api/trips/:tripId` behind `requireTripAccess`, so access is checked by construction.

**`category` is optional and already means "every category" when empty.** That is what the map uses; the category chips filter client-side, so switching a chip costs no request.

**Response** — unchanged by this feature:

```json
{
  "places": [
    {
      "id": "pl_1",
      "name": "Ichiran Shibuya",
      "name_ja": "一蘭 渋谷店",
      "category": "food",
      "summary_line": "Tonkotsu, open late…",
      "image_url": null,
      "address": "1-22-7 Jinnan, Shibuya",
      "lat": 35.6614,
      "lng": 139.7006
    }
  ]
}
```

`lat` and `lng` are `null` for a place with no location. **They are returned as null rather than omitted**: the client counts them (FR-019), and an absent key and a null value are not equally easy to count honestly.

### The guarantee (FR-016)

> A caller whose `TripView` withholds stays receives **no `hotel` object in this array**, on any value of `category` including the empty one.

Enforced in `listZonePlaces` (`server/src/services/zones.ts`), which filters before the response is built — not in the route and not on the client. Asserted in `server/tests/map-pins.test.ts` against the response body, so the test fails if anyone reorders the filter or adds a path around it.

The client's hotel chip is hidden for the same caller. That is courtesy; this is the control.

### Errors

Unchanged, and inherited: `404 NOT_FOUND` for a zone in another trip _and_ for a trip the caller is not a member of — indistinguishable on purpose (FR-018). `400 VALIDATION` for a category that is neither empty nor one of the five.

---

## 2. Trip bundle — the whole-trip map's pins

```
GET /api/trips/:tripId
```

Already returns `steps[].zone` as the whole zone row, `lat` and `lng` included, plus `place_counts` per zone with stays already zeroed for a caller who may not see them. The whole-trip scale therefore needs **no request of its own** and works today, before any backfill runs.

The map reads: `steps[].id`, `steps[].position`, `steps[].start_date`, `steps[].end_date`, `steps[].zone.{id,name,lat,lng,place_counts}`. Nothing else, and nothing new.

---

## 3. Place writes — how a location gets stored

```
POST   /api/trips/:tripId/zones/:zoneId/places
PATCH  /api/trips/:tripId/places/:placeId
```

Both already accept `lat` and `lng` and already validate them (−90…90, −180…180, `null` permitted) in `collectPlaceErrors`. Both already answer with `placeView`, the same shape the zone list renders per item, which is what lets a saved place be written straight into the cached list.

**This feature adds no field and changes no validation.** The location picker is a client-side change that fills two fields the API has always taken.

Omitting `lat`/`lng` from a `PATCH` leaves them alone; sending `null` clears them — the same convention `flight` follows.

---

## 4. Geocoding — unchanged, one new caller

```
GET /api/geocode?q=&lat=&lng=
```

Already exists, already proxies Nominatim with the `User-Agent` its policy requires, already biases by a lat/lng, already caches for 10 minutes, and already answers `{ results: [] }` rather than a 500 when the upstream is unreachable — search is best-effort by design.

The place form becomes its second caller (the journey editor is the first), biasing by the zone's coordinates. `server/src/services/geocode.ts` gains `resolvePlaceLocation()` — a small wrapper returning the best single candidate or `null` — and `setGeocoder()` as the test seam, matching `setDataStore()` and `setTokenVerifier()`. **The route is not changed.**

The backfill script calls `resolvePlaceLocation` directly, in-process, at one request per second. It never goes through HTTP, because a serverless request cannot hold that rate.

---

## 5. Client-side contracts (no HTTP)

Two boundaries in `src/` are contracts in the same sense — things written against an interface rather than an implementation.

### `MapEngine` — `src/map/engine.types.ts`

The port every map consumer programs against. `engine.leaflet.ts` is the only implementation that touches Leaflet; `engine.fake.ts` is the one every test uses.

```text
mount(container, { center, zoom }): void
setPins(pins: MapPin[]): void
fitTo(bounds: Bounds | null): void
setSelfMarker(position: { lat, lng } | null): void
onPinTap(handler: (id: string) => void): void
destroy(): void
```

No Leaflet type appears in this file. Nothing above it imports `leaflet`. A lint rule or a review note is enough to keep that true; the import graph makes a violation obvious.

### Tiles — `src/map/tiles.ts`

One module owns the tile URL template and the attribution string, because FR-013 makes the attribution a requirement of using the tiles at all and a string duplicated across two components is a string that gets removed from one of them.

---

## Endpoints this feature does not touch

The flight, the shopping list, the documents, the itinerary, the members and the export are unchanged. They carry nothing the map reads, and the map adds nothing they could carry.
