# Phase 0 — Research: Explore, connected to the plan

Everything below was resolved against the code on `main`; nothing is left as NEEDS CLARIFICATION.

---

## R1 — Can the city page answer this without a new request? (FR-020, SC-007)

**Decision**: Yes. No endpoint, no migration, no server change beyond one regression test.

**Rationale**: `src/pages/Zone.tsx` already calls all three hooks it needs:

| Hook                   | Already used for                      | What this feature also needs from it                                                |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| `useZone(zoneId)`      | the Explore grid's `place_counts`     | unchanged                                                                           |
| `useTrip(tripId)`      | the hero photo, `zoneDays`, `eyebrow` | `steps` (already read)                                                              |
| `useItinerary(tripId)` | the Schedule section                  | every item's `zone_id`, `day`, `position`, `category`, `place_category`, `place_id` |

`GET /api/trips/:id/itinerary` returns the **whole trip's** activities in one call — the client already
groups them by day itself. So the city's plan is a filter over data in hand.

`CategoryList` currently calls only `useZone` + `useZonePlaces`, so it gains `useTrip` and
`useItinerary`. Both keys are already populated by the city page one tap earlier and are shared through
the same `queryClient`, so in the ordinary path this is a cache read. Opened cold from a bookmark it is
two requests the route would have needed anyway to render a breadcrumb — acceptable, and still zero
_new_ endpoints.

**Alternatives considered**:

- _A `planned_counts` field on the zone detail response._ Rejected: it would put a second copy of the
  day-to-city rule on the server, where it would drift from `daySections` — the exact failure the map's
  `zonePlaceListItem` guard exists to prevent. It would also need its own view filtering.
- _A new `GET /zones/:id/planned` endpoint._ Rejected on the same grounds, plus a request on the app's
  second-busiest screen for data already downloaded.

---

## R2 — What decides that an activity is "in this city"? (FR-003)

**Decision**: `daySections(steps, day, itemsOfThatDay, zoneId)[0].items`, evaluated over
`zoneDays(steps, zoneId, enumerateDays(start, end))` — literally the call `Schedule` makes in `mode="zone"`.

**Rationale**: FR-003 demands that Explore and the Schedule on the same page can never disagree. The only
way to guarantee that rather than hope for it is to run the same function. It also gets three edge cases
right for free:

- a day two cities share is counted by the city each activity is pinned to (`i.zone_id === zoneId`);
- an activity pinned to no city shows on every city page whose days it falls in
  (`i.zone_id == null && here`) — the pre-existing rule for rows written before the city question existed;
- an activity on a day this city is not visited is never seen, because that day is not in `zoneDays`.

**Alternatives considered**: filtering `items` by `zone_id === zoneId` alone. Rejected: it silently drops
every legacy null-city activity from Explore while the Schedule ten lines above still shows it — two
halves of one page disagreeing, which is the bug this feature exists to fix.

---

## R3 — Where does the per-member view get enforced? (FR-018)

**Decision**: mostly already, server-side. One residual case is closed client-side by a `hidden`
parameter on `cityPlan`, fed from `useTripShows()`.

**Rationale**: three of the four routes into a leak are already shut:

1. **Saved counts** — `getZoneDetail` passes `place_counts` through `hideStayCounts` when the caller
   cannot see stays, so the Stays card already never appears for them, and the "saved or planned"
   visibility rule inherits that.
2. **The derived tag** — `listItinerary` nulls `place_id` on any activity pointing at a stay such a
   member may not see, and `place_category`/`place_files` are computed _from_ `place_id`, so both arrive
   null. A count built on `place_category` cannot resurrect a withheld stay.
3. **Saved place rows** — `listZonePlaces` filters stays out before projection, so `byPlace` has nothing
   to mark.

The one gap is the traveller's **typed** `category: 'hotel'` on an activity (`itinerary_items.category`,
migration 0022), which the server does not clear — it is the traveller's own word, attached to no place,
and clearing it server-side would change what the day plan draws today. Left alone it would let a
restricted member's Explore grid grow a Stays card reading "0 saved · 1 planned", which FR-018 forbids.
So `cityPlan` takes the categories this member may not see and drops them from both `byCategory` and the
counts.

**Alternatives considered**:

- _Clear the typed category server-side alongside `place_id`._ Rejected: it would blank the pill the day
  plan draws today for that member, which is a change to an unrelated screen, and it conflates "you may
  not see the booking" with "you may not know we are sleeping somewhere".
- _Filter in the two pages._ Rejected: two copies of one privacy rule, in JSX, untestable on data. One
  named parameter on one pure function is testable and is the thing a reviewer can check.

**Consequence for the pill (R6)**: for a hidden category the pill stays exactly as it renders today, but
is **not** linked — linking would send that member to a list that can only tell them the stays are private.

---

## R4 — What does "planned" count, exactly? (FR-001, spec Assumptions)

**Decision**: the number of **activities** of that category in that city, whether or not they link to a
saved place. Saved and planned are two numbers answering two questions, shown side by side, and neither
is a subset of the other.

**Rationale**: the alternative — counting only activities that link to nothing saved — makes the number
match the length of the planned band exactly but makes the label a lie: a city with four food spots all
scheduled would read "4 saved" and say nothing about the plan, which is the state the feature is for.
Counting activities also makes the band length equal the count (one row per activity), which is what
SC-003 is verified against.

Two dinners at the same ramen shop are two planned things and one saved thing. That is the honest
reading, and it is why the saved row's marker says "+ 1 more" rather than trying to be a count.

**Alternatives considered**: distinct places planned. Rejected: it cannot count the tag-only activities
that have no place, which are the ones the feature exists to surface.

---

## R5 — Where does a planned row go when tapped? (FR-010)

**Decision**: linked → the place; unlinked → the city page (`/trips/:tripId/zones/:zoneId`), which is
where that day's plan is read and edited.

**Rationale**: a tag-only activity has no page of its own — it exists only as a row on a day. The city
page's Schedule is the nearest true destination, and the traveller lands where they can act on it.
Deep-linking to the specific day would be better still, but the Schedule's selected day is component
state with no route or query parameter behind it, and inventing one is a second feature (noted for
follow-up, not built here).

**Alternatives considered**: making the row inert. Rejected — a row that looks like the others and does
nothing reads as broken.

---

## R6 — When can the tag on the day plan be a link? (FR-015, FR-016)

**Decision**: link to `item.zone_id ?? (zoneChoices ? null : zoneId)`; no city → no link.

**Rationale**: `Schedule` already sets `zoneChoices` **only** on a day two cities share on the trip
screen — it is the screen's own existing admission that it cannot tell which city an activity belongs to,
which is why the add form asks there. Reusing that signal means FR-016 needs no new guessing rule and no
new prop. On a city page, and on any single-city day, `zoneId` is a fact, so a legacy null-city activity
still links correctly.

**Alternatives considered**: falling back to `primaryStep`. Rejected: `primaryStep` on a moving day is
the arrival city, which is the precise mis-stamping the `zoneChoices` question was introduced to end;
using it here would reintroduce it as a navigation bug.

---

## R7 — Is the feature flagged?

**Decision**: no flag.

**Rationale**: both flags in the app (`export-trip`, `show-map`) gate a _new screen_ with a route and a
rollout risk. This changes two existing screens and adds nothing that can be bookmarked. A flag would
also mean local dev and every deploy without `VITE_POSTHOG_PROJECT_TOKEN` never see it, which for a
change to the second-most-used screen is a cost with no matching risk.

---

## R8 — Analytics (FR-021)

**Decision**: one new event, `explore_planned_opened`, declared in `src/lib/analytics-events.ts` before
any call site:

```ts
explore_planned_opened: {
  category: Category
  source: 'tag' | 'card'
  planned_count: number
}
```

**Rationale**: three shapes — an enum already sent by `map_pin_opened`, a two-value enum for which way in
was used, and a count. No title, no place name, no day. `sanitizeProperties` would drop a title anyway;
the point is not to write one. The event answers the only question worth asking of this feature: is the
connection used, and from which end.

**Alternatives considered**: reusing an existing event with a new property. Rejected — `AnalyticsEventProperties`
is deliberately per-event so a chart cannot silently change meaning.

---

## R9 — Testing strategy

**Decision**: the rules are tested on data, the screens on the DOM, and the privacy claim is tested twice.

- `src/tests/explore.test.ts` — `cityPlan` and its selectors over hand-built fixtures: the shared day, the
  null-city activity, the typed-tag precedence, `other` excluded, ordering, the hidden category.
- `src/tests/explore-grid.test.tsx` — the card's two numbers, the planned-only card appearing, the
  nothing-planned card unchanged, no Stays card for a restricted member.
- `src/tests/explore-list.test.tsx` — two bands, the day/time on planned rows, the marker on saved rows,
  the planned-but-nothing-saved empty state.
- `src/tests/day-plan.test.tsx` (existing file, extended) — the pill links; the pill does not link on a
  shared day with no city; an untagged activity is unchanged.
- `server/tests/itinerary.test.ts` (existing file, extended) — the regression that carries R3: an activity
  linked to a stay a member may not see arrives with `place_id`, `place_category` and `place_files` empty.
  Asserted on the response body, the same posture as `server/tests/map-pins.test.ts`.

**Rationale**: the one thing that must never break is the view rule, and a DOM assertion is a poor place
to prove it. It is proven on the payload (server) and on the function (client), with the screens tested
for what they render.
