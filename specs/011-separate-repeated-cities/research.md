# Phase 0 Research: Separate pages for repeated cities

**Feature**: `specs/011-separate-repeated-cities` | **Date**: 2026-08-29

## R1. What is a "visit"? — the one decision everything else follows from

**Decision**: **A visit is a zone.** `resolveZoneId` stops finding-or-creating by name; every stop gets its own zone row. A repeated city becomes two zone rows that happen to share a name, each owning its own places, tips, files and itinerary links exactly as a zone does today.

**Rationale**:

1. **The codebase has already made this call once, one level up.** `server/src/services/steps.ts` carries the comment: _"Find-or-create is now per trip: two trips to Tokyo each get their own Tokyo, with their own places and notes, rather than sharing one."_ This feature is the same argument applied at the next boundary — two _visits_ to Tokyo each get their own Tokyo. Nothing new has to be invented, and the reasoning is already written down and agreed.
2. **The scar is already in the code.** `server/src/lib/export-view.ts:315` says _"A zone reached by more than one step appears under each — the document follows the journey, not the map — so the counts deduplicate by id"_, and maintains a `counted` Set purely to stop Tokyo's places being tallied twice. That workaround exists **because** one zone is reached by two steps. Under this model it becomes dead code and is deleted: each step's zone has its own places, so nothing is ever counted twice. A design that removes an existing workaround is usually the right one.
3. **Blast radius.** ~40 files key on `zone_id`. This model changes what a zone _means_ without changing the shape of anything that reads one, so those 40 files are untouched. The rejected alternatives all rewrite them.
4. **The invariant survives**: place → zone → trip, step → zone. Every access check, view filter, field policy and cache write keeps working unchanged.

**Alternatives considered**:

| Alternative | Why rejected |
| --- | --- |
| **Add `step_id` to places/tips/files/itinerary** (content belongs to the step; the zone stays the city) | Architecturally tidy and satisfies a shared city identity for free, but it rewrites ~40 files: every `listPlaces(tripId, zoneId, …)`, both datastores, the export field policies, the map's two scopes, search, and every cache-write helper in `src/api/mutations.ts`. It also creates two ways to ask "where is this place" (its step, and its step's zone) with no rule about which wins. |
| **A new `cities` table, zones become visits pointing at it** | The fully normalised answer, and the most expensive: a new table, a migration that has to be applied to a live project by hand (see CLAUDE.md), a new access-check surface, and a second identity to keep in sync. Buys only the shared photo, which R2 gets more cheaply. |
| **Split only for display; keep one zone** (filter a zone's content by the open step's date range) | Places carry no date, so there is nothing to filter them by. It would work for the day plan, which is already right, and for nothing else. |

**Cost accepted**: the two Tokyo zones each hold their own photo, name and summary. Changing Tokyo's photo changes one stay. See R2 for how they stay recognisably one city.

## R2. Keeping the sibling relationship — `zones.city_key`

**Decision**: add one nullable column, `zones.city_key` (migration 0023). Zones created for the same destination on the same trip share a key; it is set at creation from the normalised destination name, and does not change when a zone is renamed.

**Rationale**: three requirements need to know that two zones are the same city, and none of them can use the name:

- **FR-009 / FR-014a** — "move to another visit" must offer only the _other visits of this city_, and must keep working after one visit is renamed ("Tokyo (last days)"). Matching on `name` would silently stop offering the move the moment someone renames one.
- **FR-005** — the visit label ("2nd visit") is an ordinal among siblings.
- **FR-017** — the map at trip scale wants to know two pins are the same city.

**Why not match on name**: it is exactly the find-or-create rule this feature removes; reintroducing it as a display rule would mean two zones that are the same city until someone edits a letter.

**Why nullable**: every existing zone gets one in the migration, but a zone is perfectly meaningful without one, and a nullable column cannot break an existing read.

## R3. Where visits are created — `resolveZoneId`

**Decision**: `resolveZoneId` always creates a zone from a `destination`, never reuses one by name. An explicit `zone_id` on `POST /steps` keeps meaning "this exact visit" and is rejected if that zone already has a step, since a zone is now one visit and cannot be two.

**Rationale**: FR-006. This is the behaviour change; everything else in the feature is a consequence of it. The validation on `zone_id` is what stops the old pooling being recreated through the back door.

**Alternatives**: leaving `zone_id` unvalidated was rejected — it leaves one code path that still produces a shared zone, which is the bug.

## R4. Dividing the Japan trip's existing Tokyo content

**Decision**: a journalled, dry-run-by-default, revertible script — `npm run split:visits`, modelled directly on `scripts/backfill-coords.ts`. Not a SQL migration.

**Rationale**:

- CLAUDE.md is explicit that committing a migration is not deploying it, and that the live Supabase project has no migration runner. A data split that has to be _right first time_ (FR-012c, spec Assumptions: "there is no undo") should not be a SQL file someone pastes into an editor.
- `backfill-coords.ts` already established the shape the repo trusts for exactly this: dry run by default, a journal of what it did, `--revert`.
- The split rule is FR-012: a place linked to an activity whose date falls inside a visit goes to that visit; FR-012a earliest wins; FR-012b anything undated goes to the first visit.

**Verified against the live seed** (`server/src/data/placeholder-data.json`), Tokyo's 6 places resolve with no ambiguity:

| Place | Category | Resolves to |
| --- | --- | --- |
| Senso-ji Temple | attraction | Visit 1 (19–25 Sep) |
| teamLab Planets | attraction | Visit 1 (19–25 Sep) |
| Hotel Gracery Shinjuku | hotel | Visit 2 (12–16 Oct) |
| Shibuya Crossing & Sky | attraction | Visit 2 (12–16 Oct) |
| Don Quijote Kabukicho | shopping | Visit 2 (12–16 Oct) |
| Ramen night in Shinjuku | food | Visit 1 — unscheduled, so FR-012b |

No place is scheduled inside both visits, so FR-012a does not fire here; it is specified and tested anyway because a later edit can create one. Tokyo's 2 tips carry no date and go to visit 1 (FR-012b). Its 80 itinerary items split by their own `day` and need no rule.

**The handover day** (research note added after checking the seed): stop ranges overlap by a day at **every one of the trip's 9 handovers** — Tokyo ends 25 Sep, Hakone begins 25 Sep — so "the visit whose dates contain this day" is ambiguous once per handover. FR-015a settles it: the day belongs to the **departing** visit, the one whose stay is ending, because a travel morning is spent where the traveller woke up and that is the visit holding the hotel being checked out of. One helper owns the rule so the split script and the day plan cannot disagree about the same day. It does not change the Tokyo split (the two Tokyo visits share no boundary), but it is the difference between a stated rule and an accident of iteration order.

**The script runs twice**: against `server/src/data/placeholder-data.json` (so the memory backend and every test fixture match production) and against Supabase.

## R5. Naming a visit

**Decision**: the label is derived, never stored. A zone whose `city_key` has no siblings shows nothing (FR-003). One with siblings shows its step's dates ("19–25 Sep"), falling back to an ordinal among siblings ordered by `start_date` then `position` ("2nd visit") when two visits cannot be told apart by date.

**Rationale**: FR-005, and the edge case of two visits with equal dates. Deriving it means a date change on a stop relabels its page with no write. One pure helper — `src/lib/visit-label.ts` — is the only place the wording lives, so the journey card, the page header, the breadcrumb, the search subtitle and the export section heading cannot drift apart.

**Note**: `stepView` already returns the step's dates alongside the zone, so the journey needs no new data. The zone page does: see R6.

## R6. The zone page needs its step

**Decision**: `GET /api/trips/:tripId/zones/:zoneId` gains a `visit` block — the zone's step dates, its ordinal among siblings, and how many siblings there are. No new endpoint.

**Rationale**: the page has a `zoneId` and needs the dates to label itself and the sibling list to offer the move (FR-009). Adding it to the detail response the page already fetches costs one store read and no round trip, and keeps the "a route added under `/api/trips/:tripId` is access-checked by construction" property intact.

**Alternative rejected**: deriving it on the client from the trip bundle's steps. The bundle is already loaded, so this is tempting — but it puts the sibling/ordinal rule in the client for the page and on the server for the export, which is precisely the drift `summary_line` and `lib/ordering.ts` exist to prevent.

## R7. Moving a place or tip between visits

**Decision**: `PATCH /api/trips/:tripId/places/:placeId` accepts `zone_id`, validated to be a zone on the same trip sharing the moved place's current `city_key`. Same for tips and files. The response is the moved row in its list's shape, as every write already answers (`lib/place-view.ts`).

**Rationale**: FR-009 is a re-parent, and the field that parents a place is already `zone_id`; adding a verb would be inventing a second way to do one thing. The `city_key` check is what makes it "another visit of this city" rather than "any zone on this trip" — moving Senso-ji to Kyoto is not what the button says.

**FR-010 (crossing a day-plan link)**: the move is refused with the usual `VALIDATION` envelope naming the activities that would be stranded, and the client asks whether to bring them along; confirming re-parents the items too. Modelled on `GET /trips/:id/date-impact`, which already answers "what would this change strand" before a destructive edit.

**Cache**: `replaceById` cannot be used — the row leaves one list and joins another. The move invalidates both zones plus the trip bundle (counts), and returns the invalidation from `onSuccess`, so the toast lands with the screen (CLAUDE.md).

## R8. Deleting a visit that still holds content

**Decision**: `DELETE /steps/:stepId` deletes the step; its zone and everything in it survive, unreachable from the journey but reachable from search and the trip's own file list. The client warns first, naming the counts, and offers to move the content to a sibling visit.

**Rationale**: FR-011, and the repo's existing rule — deleting a place reparents its files to the trip rather than losing them ("no silent file loss" is a deliberate product rule). Cascading a step delete into its places would be the first place in the app where content vanishes because a date changed.

**Follow-on**: an orphan zone (no step) must not crash a page that assumes one. `stepView` and the new `visit` block both tolerate it; the export walks steps, so an orphan zone is simply absent from the document, which is correct — it is not on the journey.

## R9. The surfaces that only need labels

None of these change shape; each renders the R5 label where it already renders a zone name.

- **Search** (`services/search.ts`): a zone result's subtitle is `'Zone'` today; it becomes the visit label for a repeated city. A place result gains its visit in the subtitle (FR-016). `href` is unchanged — `/zones/:id` already addresses a visit under this model.
- **Map** (`src/map/scope.ts`): `tripScope` already builds from steps, so it lists visits already; only the chip label changes. `zoneScope` is per-zone and therefore already per-visit. FR-017 is close to free.
- **Export** (`lib/export-view.ts`): each step projects its own zone, which is already the loop. The `counted` dedup Set is **deleted** (R1). Section headings take the label.
- **Breadcrumbs / day plan**: `Schedule.tsx`, `DayPlan.tsx` and `AddPlaceToDay.tsx` link by `zone_id`, which now resolves to the visit. FR-015 and FR-019 need the label only.

## R10. No feature flag

**Decision**: ship unflagged.

**Rationale**: `export-trip` and `show-map` are flagged because they are additive surfaces that can be switched off without leaving anything behind. This feature migrates data. A flag could hide the label but not un-split the rows, so it would advertise a rollback that does not exist. The real safety net is R4's `--revert`.

## R11. Testing

- **Server**: the fixture store (`server/tests/fixture.ts`) gets a two-visit trip. New files: `steps-visits.test.ts` (FR-006 and the `zone_id` rejection), `visit-move.test.ts` (FR-009/FR-010), `split-visits.test.ts` (the R4 rule, including the FR-012a both-visits case the live data does not exercise). Existing `export.test.ts` gains the no-duplication assertion (FR-018), and `map-pins.test.ts` the per-visit one.
- **Web**: `src/tests/` — the visit label helper (pure, table-tested like `lib/permissions.ts`), the zone page showing a label only when siblings exist (FR-003), and the move flow.
- **`npm run typecheck`** is part of the path, as always: `city_key` on `Zone` is not a `keyof Place`, so it does not trip the export policy, but the `visit` block on the zone detail response is typed and the export's `ExportZone` is touched.

## R12. Ordering

`src/lib/ordering.ts` mirrors the datastore's ordering so a saved row can be put back in place. Zones have no client-side order today and gain none: siblings are ordered by their step's `start_date`, which the trip bundle already returns sorted. Nothing to mirror.
