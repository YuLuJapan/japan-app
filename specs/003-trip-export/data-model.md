# Phase 1 Data Model: Export the Trip

**No new tables, no new columns, no migration.** Everything below is a projection of rows that already exist.
Two new read methods are added to the `DataStore` interface; both are queries against existing tables.

---

## 1. The field policy — the centre of the feature

One level per field of every entity that can reach an export. Adding a column to `Place` without adding it
here is a compile error, because the map is typed `Record<keyof Place, ExportLevel>` (research R6).

```ts
type ExportLevel = 'share' | 'full' | 'never'
// 'share' → in both versions · 'full' → full only · 'never' → in neither
```

### Place (`server/src/lib/datastore.ts`)

| field | level | why |
| --- | --- | --- |
| `name` | share | half of what a share export *is* |
| `address` | share | the other half |
| `category` | share | how the recipient reads the list |
| `id` | never* | not in the readable formats; present in the JSON backup (US4) |
| `zone_id` | never* | same — structure is expressed by nesting in the readable formats |
| `description` | full | carries the booking reference; the reason share exists |
| `links` | full | a reservation link is a reservation |
| `name_ja` | never | deferred this phase — backlog, returns with the CJK font work |
| `image_url` | never | photos are not in scope for any format |
| `lat` / `lng` | never | 0 of 39 places have them today; no export need |
| `summary_line` (derived) | never | the first 100 chars of the description, so it carries what the description carries |

\* `id` and `zone_id` are emitted **only** by the JSON writer (US4), which round-trips identifiers by design.
The policy carries a fourth column, `json`, for exactly these two; the readable writers never read it.

### Zone

| field | level |
| --- | --- |
| `name` | share |
| `summary` | full |
| `id` | never* |
| `name_ja`, `image_url`, `lat`, `lng` | never |

### Trip

| field | level |
| --- | --- |
| `title` (derived, `lib/trip-title.ts`) | share |
| `start_date`, `end_date` | share |
| `country` | share |
| `description` | full |
| `flight` | never | **FR-004a** — out of both versions |
| `people` | never | **FR-004a** — member names are out |
| `local_currency`, `home_currencies` | never |
| `start_time`, `start_tz`, `id` | never* |

### JourneyStep

| field | level |
| --- | --- |
| `position`, `start_date`, `end_date` | share |
| `zone_id` | resolved to the nested zone, not emitted |
| `id`, `trip_id` | never* |

### Tip

| field | level |
| --- | --- |
| `body` | full |
| `id`, `zone_id`, `place_id` | never* — the tip is nested under its parent |

### ItineraryItem

| field | level |
| --- | --- |
| `day`, `start_time`, `title`, `position` | full |
| `note` | full |
| `highlight`, `icon` | full |
| `place_id` | resolved to a place name where visible, else omitted |
| `id`, `trip_id`, `zone_id` | never* |

### Not in the model at all

`FileAttachment`, `ShoppingItem`, `TripMember`, `FlightInfo`, `Reminder`, `Profile`, `TripInvite`. Per
FR-004a these never enter an export at either detail level, so they are absent from the policy rather than
marked `never` — a field that cannot be classified is a field nobody can accidentally promote.

---

## 2. The export payload (the endpoint's response)

Nested rather than flat, because nesting is what the readable formats render and what makes the structure
survive without ids.

```
ExportPayload
├── detail: 'share' | 'full'
├── generated_at: ISO instant          — stamped by the server, printed in the footer
├── trip: { title, start_date, end_date, country, description? }
├── steps: ExportStep[]                — journey order (position), the document's spine
│   └── ExportStep
│       ├── start_date, end_date
│       └── zone: { name, summary?, places: ExportPlace[], tips?: string[] }
│           └── ExportPlace: { name, address, category, description?, links?, tips?[] }
├── days: ExportDay[]                  — full only; empty array at share detail
│   └── { day, zones: string[], items: [{ start_time?, title, note?, highlight, icon?, place_name? }] }
└── stats: { place_count, places_without_address, day_count, included_stays }
```

**Rules that hold at both levels**

- Order is the server's: steps by `position`, places by the existing zone ordering, day items by
  `day` then `position`. `src/lib/ordering.ts` already mirrors this; the export does not re-sort.
- A zone reached by more than one step appears under each — the document follows the journey, not the map.
- A zone with no visible places is rendered with an honest empty section (spec edge case), never dropped.
- Optional keys are **absent, not null**, at share detail. This is the same idiom as the trip bundle's
  `flight` key, and it means a share payload cannot carry an empty container that a writer might label.
- `stats.places_without_address` is what FR-018 reports; `included_stays` is the exporter's view, not a
  property of any place.
- **`days` runs the whole trip**, `start_date` to `end_date`, not only the days somebody typed into. A
  day-by-day plan that skips its empty days is a list of activities, and the gaps are exactly what a reader
  plans into. A day with nothing on it is listed with an empty `items` array. (Any day carrying an item from
  outside the trip's window is included too — the range rule makes that impossible today, and an export that
  silently dropped a stranded activity would be worse than one printing a day off the end.)
- **`zones` is the city or cities the day touches**, in journey order: one ordinarily, two on the day you
  move between stops, because a step's last day and the next step's first day are the same date. This
  mirrors `coveringSteps` / `dayZones` in `src/lib/schedule.ts`, which is what the app's own day-by-day
  screen shows above each day — without it a printed plan reads "6 Oct · 20:00 Ramen Bar" and leaves the
  reader to work out which city they are in. Empty for a day no step covers, which is a real gap in the
  journey and is shown as one.
- `stats.day_count` counts the days **carrying at least one item**, so it stays the answer to "how much of
  this is planned" now that `days.length` is the trip's length.

---

## 3. Validation

One input. `detail` must be exactly `share` or `full`; anything else (including absent) is
`400 VALIDATION` with `details: ['detail must be "share" or "full"']`. Following the house pattern, errors are
collected into an array even though there is only one field, so the shape matches every other service in
the app and does not change if the route ever takes a second input. **`format` is not one of them**: the file
type is decided on the device, so it never reaches the API.

---

## 4. Order of filtering — this sequence is the requirement

```
rows from the store
   → 1. TripView          (FR-008)  drop hidden stays, tips on a stay, itinerary links to a stay
   → 2. field policy      (FR-010)  explicit pick, per entity, per field
   → 3. shape             nest, order, count
```

Step 1 before step 2, always. Reversed, a hidden stay would be reduced to a name and an address and then
exported — technically harmless at share detail and a straight leak at full. The projection function takes
`TripView` as its first argument so the ordering is expressed in the signature rather than in a comment.

**What step 1 drops**, concretely: places where `category === 'hotel'` when `view.stays` is false; tips whose
`place_id` is one of those places; itinerary items' `place_name` where the place is hidden (the row stays, its
link does not — the same treatment the itinerary service already gives `place_id`).

---

## 5. New `DataStore` methods

```ts
/** Every place in the trip, all zones, all categories — the export's single sweep. */
listAllPlaces(tripId: string): Promise<Place[]>

/** Every tip in the trip, zone-level and place-level alike. */
listAllTips(tripId: string): Promise<Tip[]>
```

Implemented in `datastore.memory.ts` and `datastore.supabase.ts`. Ordering must match what
`listPlacesInZone` and `listTips` already return for the same rows — `server/tests/ordering.test.ts` is the
precedent for pinning that with a shared test rather than trusting two implementations to agree.
