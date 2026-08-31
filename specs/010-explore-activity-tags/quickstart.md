# Quickstart — validating "Explore, connected to the plan"

## Prerequisites

```bash
npm install
```

No environment variables are needed. The default `DATA_BACKEND=memory` seeds from
`server/src/data/placeholder-data.json`, which is real trip content — several cities with saved places
and a plan — so the feature has something to show without touching Supabase.

## The checks that must pass

```bash
npm test          # both projects; the new explore.* tests live in src/tests/
npm run typecheck # not optional in this repo — vitest transpiles types away
npm run lint
```

Narrower loops while working:

```bash
npx vitest run src/tests/explore.test.ts          # the pure rules
npx vitest run src/tests/explore-grid.test.tsx    # the city page's grid
npx vitest run src/tests/explore-list.test.tsx    # the category list's two bands
npx vitest run src/tests/day-plan.test.tsx        # the tag link
npx vitest run server/tests/itinerary.test.ts     # the withheld-stay regression
```

## Seeing it in the app

```bash
npm run dev    # web on :3000, API on :3001
```

Signing in needs Supabase Auth configured (`.env.example`). Without it the gate has no working button —
in that case rely on the tests and on `npm run build && npm run preview` for a smoke test of the bundle.

With a session: open a trip → open a city with days in it → the Explore grid is under the Schedule.

## Walking the acceptance scenarios by hand

| #   | Do this                                                                                         | Expect                                                                                             |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Open a city that has saved food spots and no plan                                               | The Food card reads "N saved" — exactly as before this feature (SC-006)                            |
| 2   | On the trip screen, add an activity on a day in that city, tag it **Food**, link no place       | The city's Food card now reads "N saved · 1 planned" (FR-001, FR-003)                              |
| 3   | Open that Food card                                                                             | An "On the plan" band above the saved places, with the day and the time; the saved list below      |
| 4   | Tap the planned row                                                                             | The city page opens (the activity links to no place) (FR-010)                                      |
| 5   | Add an activity in the same city tagged **Shopping** in a category with nothing saved           | A Shopping card appears reading "0 saved · 1 planned" and opens (FR-004)                           |
| 6   | Add an activity linked to a saved food place                                                    | That place's row in the Food list carries a "Planned …" marker; the planned band gains its row too |
| 7   | Add a second activity on the same place                                                         | The marker names the first and says "+ 1 more" (FR-011)                                            |
| 8   | On the day plan, tap an activity's category pill                                                | That city's category list opens (FR-015)                                                           |
| 9   | On a day two cities share, on the **trip** screen, tap the pill of an activity pinned to a city | That city's list opens — not the other one (FR-015, spec Story 3 scenario 3)                       |
| 10  | Same day, an activity pinned to no city                                                         | The pill is drawn but is not tappable (FR-016)                                                     |
| 11  | An activity with no tag                                                                         | No pill, nothing added (FR-017)                                                                    |

## The privacy check, by hand

Requires a second account and a shared trip (Members → invite as **viewer** with "can see stays" off).

| Do this                                                 | Expect                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Open a city as the restricted member                    | No Stays card at all — not with a saved count, not with a planned one (FR-018) |
| The owner adds an activity typed-tagged **Stays** there | The restricted member's grid is unchanged; no Stays card appears               |
| An activity links to a stay that member cannot see      | It appears with no category and no place link, and marks nothing in any list   |

This is the claim `src/tests/explore.test.ts` (the `hidden` cases) and `server/tests/itinerary.test.ts`
(the payload) both cover; the manual pass is a sanity check, not the proof.

## Verifying "no new requests" (SC-007)

With the app open on a city page, open the browser's network panel and reload. The requests are the same
set as before this feature: the trip bundle, the zone detail, the itinerary. Opening a category list adds
`…/zones/:id/places?category=…` as it always did; the trip and itinerary calls it now uses are served
from the TanStack Query cache the city page filled.
