# 010 — Plan

**Spec:** [`spec.md`](./spec.md) · **Data:** [`migration.md`](./migration.md)

## The shape of the change

Two entities become one. `Place` and `ItineraryItem` collapse into `Activity`, the two services
collapse into one, the two routers collapse into one mounted on `tripScopedRouter` (so the
merged routes are access-checked by construction, which is the property to preserve), and the
client's two hook families collapse into one list the screens derive everything from.

**There is no feature flag, and that is worth stating plainly.** Every other feature in this
repo hides behind a PostHog default-off flag — `show-map`, `export-trip`, `chat-bot` — because
each adds a surface that can be withdrawn. This one _replaces_ the app's two most-used
entities and moves their rows, so there is no state in which both the old and new code are
correct. The safety story is structural instead: migrate, cut over, contract — with a snapshot
taken before a single row moves, every lossy decision journalled, and a **pre-written, tested**
`rollback.sql` that restores the database byte-identically (`migration.md` §4, §7, §8).
Anything that reads like "we can flip it back" is about `git revert`, that script, and phase 3
not having run yet.

## Two things that only the type checker will catch

Both are the `export-view.ts` pattern, and both are why `npm run typecheck` is on the test path
rather than a nicety.

**1 · Three `Record<keyof Entity, …>` tables become two.** `LIST_FIELD_POLICY`
(`lib/place-view.ts`), `PLACE_FIELD_POLICY` and `ITINERARY_FIELD_POLICY`
(`lib/export-view.ts`) are all keyed on the entity. Merging the entities makes every one of
them a compile error until each field of `Activity` has been classified exactly once. That is
the guard working, not an obstacle — do not widen the keys to `string` to make it build.

**2 · The two export policies disagree on one field, and it is not a typo.**

| field                                    | as a place | as a plan item | merged  |
| ---------------------------------------- | ---------- | -------------- | ------- |
| `name` / `title`                         | `share`    | `full`         | `share` |
| `category`                               | `share`    | `never`        | `share` |
| `description` / `note`                   | `full`     | `full`         | `full`  |
| `day`, `start_time`, `highlight`, `icon` | —          | `full`         | `share` |

Today `projectDays` opens with `if (!admits(ITINERARY_FIELD_POLICY.day, at)) return []`, so
`day: 'full'` is doing two jobs: classifying a field _and_ keeping the whole day plan out of
the share export. Once `day` is a column on the same row as `name`, one level cannot mean both.
Split them:

```ts
/** Which sections of the document a detail level admits at all. */
export const SECTION_POLICY: Record<'saved' | 'plan', ExportLevel> = {
  saved: 'share',
  plan: 'full', // unchanged: a share export has never carried the day plan
}
```

`category` becoming `share` is a real widening — 0022 classified it `never` precisely to defer
"a field on `ExportDayItem` and a rendering decision in all four writers". That decision now
has to be made, or the day view in `src/export/outline.ts` drops the field while the saved view
keeps it. **Recommendation: drop it in the outline's day view for this change** — the merge is
already large, and the exported plan names its activity, which is the information a category
was standing in for. Record it in the outline rather than in the policy, so the field is
classified once and its _rendering_ is the thing deferred.

## Server

| file                                                                      | change                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/datastore.ts`                                                        | `Place`+`ItineraryItem` → `Activity`; `PlaceInput`+`ItineraryItemInput` → `ActivityInput`. Thirteen methods become six: `listActivities(tripId)`, `getActivity`, `createActivity`, `updateActivity`, `deleteActivity`, `listActivityIdsByCategory`. `countPlacesByCategory` → `countSavedByCategory` (undated only — it feeds Explore's grid).                                  |
| `lib/datastore.memory.ts`                                                 | one array, one comparator (below).                                                                                                                                                                                                                                                                                                                                              |
| `lib/datastore.supabase.ts`                                               | one table; keep the "fall back when a column is absent" habit 0005 established.                                                                                                                                                                                                                                                                                                 |
| `lib/place-view.ts` → `lib/activity-view.ts`                              | `LIST_FIELD_POLICY` re-keyed; `day`, `start_time`, `position`, `highlight`, `icon` classified.                                                                                                                                                                                                                                                                                  |
| `lib/export-view.ts`                                                      | one `ACTIVITY_FIELD_POLICY` + `SECTION_POLICY`; `projectPlaces`/`projectDays` become two projections of one row.                                                                                                                                                                                                                                                                |
| `lib/trip-view.ts`                                                        | new: `stripStay(activity)` — FR-021's content strip, in one place, so no caller re-derives it.                                                                                                                                                                                                                                                                                  |
| `lib/chat-files.ts`                                                       | `/trip/places.json` + `/trip/itinerary.json` → `/trip/saved.json` + `/trip/plan.json`. **Still two files** even though there is one table: the model greps by question, and "what have we saved in Kyoto" and "what happens Thursday" are different questions. Two views, one source. The listing sits above the cache breakpoint, so this invalidates the prefix exactly once. |
| `lib/chat-context.ts`                                                     | `buildTripContext` (the `eager` fallback) reads the merged list.                                                                                                                                                                                                                                                                                                                |
| `services/places.ts` + `services/itinerary.ts` → `services/activities.ts` | one `collectActivityErrors` following the collect-all-errors convention; `TAGGABLE` keeps meaning "what the day plan can draw a pill for".                                                                                                                                                                                                                                      |
| `services/zones.ts`                                                       | `place_counts` → `saved_counts`, undated only.                                                                                                                                                                                                                                                                                                                                  |
| `services/search.ts`                                                      | searches activities; the `includeStays` filter now also has to spare a _scheduled_ stay (FR-021 strips it rather than dropping it) — but search results link to a detail screen that is refused, so **scheduled stays stay out of search too**. Note it in the code; it is the one place FR-020 and FR-021 do not line up.                                                      |
| `services/files.ts`, `services/tips.ts`                                   | `place_id` → `activity_id`; `reparentFilesToTrip` unchanged in spirit ("no silent file loss" still holds).                                                                                                                                                                                                                                                                      |
| `services/export.ts`                                                      | one sweep instead of two.                                                                                                                                                                                                                                                                                                                                                       |
| `routes/places.ts` + `routes/itinerary.ts` → `routes/activities.ts`       | mounted on `tripScopedRouter`.                                                                                                                                                                                                                                                                                                                                                  |
| `routes/zones.ts`                                                         | drop `GET /zones/:zoneId/places`; the client derives it.                                                                                                                                                                                                                                                                                                                        |

### Ordering

`compareItinerary` sorted on a non-null `day`. With `day` nullable there are two orders, and
they belong to two lists rather than to one comparator with a null branch:

```
scheduled  by day, then timed before untimed, then position, then id   (unchanged)
saved      by category, then position, then name, then id              (new — Explore's order)
```

`src/lib/ordering.ts` mirrors both, and `server/tests/ordering.test.ts` keeps running the
client's copy and the datastore's over the same rows. That test is the reason a second order
is cheap to add and expensive to get wrong.

## Client

One query — `useActivities(tripId)` → every activity for the trip — and every screen is a
filter over it. That is fewer requests than today, not more: the map currently fetches a
zone's places per city on top of the itinerary.

| screen             | reads                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| trip home day plan | `day != null`, banded by `daySections` (unchanged)                    |
| city Schedule      | `day != null && zone_id == zoneId`                                    |
| city Explore       | `day == null && zone_id == zoneId`, grouped by category               |
| category list      | the same, one category                                                |
| map, city scale    | `zone_id == zoneId && lat != null` — **scheduled and saved** (FR-013) |
| map, trip scale    | unchanged: one pin per city from the trip bundle                      |
| search             | server-side, unchanged in shape                                       |

`AddPlaceToDay` stops creating a second row and becomes **Schedule this** — a `PATCH` setting
`day` (and optionally `start_time`). Its mirror, **Copy to another day**, is what FR-006 trades
against: it `POST`s a new activity carrying the original's category, address, coordinates,
photo and description, which is deliberately the same rule `migration.md` §3 applies to a place
scheduled more than once.

`PlaceForm` and the day plan's inline editor both survive, and should. The inline editor is a
quick add — name, time, tag — and is why 179 plan lines exist; the full form is where a
location, links, a photo and files go. One entity, two depths of form, no second concept.

`replaceById` / `removeById` in `api/mutations.ts` now patch **one** cache key instead of
`['itinerary']` and `['zone']` separately, which removes a class of bug rather than adding one.
The `refreshed` / `reconcile` rule is unchanged, with one addition: **setting or clearing a
date moves a row between two lists, so it reconciles rather than patches** — the same reason an
itinerary edit that can reorder a day waits for the refetch today.

## Order of work

Each step ends green (`npm test && npm run typecheck && npm run lint`).

1. ~~**Migration, dry run.**~~ **Done.** `supabase/migrations/0025_activities.sql` and
   `rollback.sql` are written and have been run against a scratch Postgres 16 built from the
   committed migrations plus the seed and four synthetic edge rows — every invariant passes,
   the day plan comes out textually identical, and the rollback restores the database
   byte-for-byte (`migration.md` §5, §8). Still to do on the live project: regenerate the
   `_match` list, dry-run with `commit` → `rollback`, read the numbers.
2. **The fold, twice.** `scripts/migrate-placeholder.ts` (TypeScript) and the SQL above, with
   `server/tests/migration-fold.test.ts` running both over the same fixture rows and asserting
   they agree — the `ordering.test.ts` discipline applied to a one-off.
3. **Datastore.** `Activity`, both stores, both orders, `ordering.test.ts` extended. The rest
   of the server still compiles against the old services, so this step is mechanical.
4. **Services and routes.** `services/activities.ts`, `routes/activities.ts`, zones' counts,
   files/tips re-parenting, search. `contracts/api.md` updated in the same commit — it is
   referenced by code comments on both sides, so a stale copy is a real cost.
5. **Visibility.** `stripStay`, and the tests for it first: `server/tests/visibility.test.ts`
   and `pentest.test.ts` should fail before the strip exists and pass after. FR-020 vs FR-021
   is the subtle one — a saved stay disappears, a scheduled one is emptied.
6. **Export and chat.** The merged policy, `SECTION_POLICY`, the outline's two views, the two
   VFS files. `export-view.test.ts` and `chat-vfs.test.ts` carry the weight.
7. **Client.** Types, hooks, mutations, then screens in this order: city page (both sections),
   category list, detail, form, day plan, map, search, export UI.
8. **Run the migration for real** (phase 1 of `migration.md` §7), then ship steps 3–7 as one
   deploy (phase 2).
9. **Soak, then contract.** `0026_drop_legacy_places_itinerary.sql`, not before the soak.

## What I would watch after the cutover

- `files_read` on `chat_turn_completed` — the VFS listing changed, so a model that used to open
  `itinerary.json` on every turn should now be opening `plan.json`. Zero would mean the fold
  broke the file builders quietly.
- Whether Explore empties out on the two active trips. If travellers now schedule everything,
  Explore becomes a rarely-visited list and the "grouped by type" grid may be the wrong shape
  for what is left — a thing to learn from use rather than to design for now.
- Whether **Copy to another day** gets used at all. If it does not, FR-006's trade was free; if
  people copy the same row repeatedly and then edit each copy, the occurrences table the spec
  declined is the thing to revisit.

## Open, deliberately

- **The detail screen's URL.** `/trips/:tripId/activities/:id` with `/places/:id` redirecting
  (FR-032). A scheduled activity and a saved one share it, which is right — they are one thing.
- **Whether Explore should show scheduled activities too, dimmed.** Argument for: a traveller
  looking for "the ramen place" does not care that it is on Thursday. Argument against: it is
  the second list the merge exists to remove. Not built; the map already answers "everything in
  this city" and search answers the rest.
- **The 5 city-less plan lines.** They keep working (FR-004) but cannot be un-scheduled without
  first being given a city. The form should say so rather than the API refusing.
