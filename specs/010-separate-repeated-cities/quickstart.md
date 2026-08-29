# Quickstart: validating separated visits

**Feature**: `specs/010-separate-repeated-cities` | **Date**: 2026-08-29

How to prove the feature works end to end. See [`data-model.md`](./data-model.md) for the split rules and [`contracts/api-delta.md`](./contracts/api-delta.md) for the response shapes.

## Prerequisites

```
npm install
```

No env vars needed. `DATA_BACKEND` defaults to `memory`, which seeds from `server/src/data/placeholder-data.json` — the Japan trip, Tokyo twice. That seed **is** the test case, so local dev reproduces production's problem exactly.

## The full gate

```
npm test          # both projects — web (jsdom) + server (node)
npm run typecheck # NOT optional: the export's field policy is a type error
npm run lint
```

`npm test` cannot see a type error, and this feature touches `Zone`, the export projection and the zone-detail response — so a green test run alone proves nothing. Run both.

## 1. The split, dry first

```
npm run split:visits              # dry run — prints the plan, writes nothing
npm run split:visits -- --apply   # writes, and journals every row it touched
npm run split:visits -- --revert  # puts it all back from the journal
```

Expected dry-run output for the Japan trip — check it against the table in `data-model.md` before applying:

```
zone-tokyo "Tokyo" — 2 steps, splitting into 2 visits
  visit 1  19–25 Sep  (keeps zone-tokyo)
    places   Senso-ji Temple, teamLab Planets
    places   Ramen night in Shinjuku        [unscheduled → first visit]
    tips     2                              [undated → first visit]
    items    41
  visit 2  12–16 Oct  (new zone)
    places   Hotel Gracery Shinjuku, Shibuya Crossing & Sky, Don Quijote Kabukicho
    items    39
nothing else on this trip has more than one step
```

**Run it twice.** The second run must report nothing to do — that idempotence is what makes `--revert` safe to follow with a re-run.

## 2. The two pages are separate (US1, FR-001/002)

```
npm run dev
```

Open the Japan trip, then from the journey:

- **First Tokyo (19–25 Sep)**: header labelled with those dates; Things to do shows Senso-ji and teamLab; Food shows Ramen night; **Stays is empty**; counts match the lists.
- **Second Tokyo (12–16 Oct)**: labelled with those dates; Stays shows Hotel Gracery; Shopping shows Don Quijote; Things to do shows Shibuya only.
- **Kyoto** (visited once): no label, no visit chooser, no move action — pixel-identical to before.

## 3. New content lands on the visit you are on (US2, FR-008)

From the second Tokyo, add a place and a tip. Both appear there; reload the first Tokyo and neither is on it.

## 4. Moving between visits (US3, FR-009/010)

- From Ramen night in Shinjuku (first visit, unscheduled), move it to the second. It leaves the first list and count, arrives on the second, keeps its links and photo.
- From Senso-ji (scheduled 20 Sep), try the same. Expect the FR-010 refusal naming the activities that would be stranded, and the choice to bring them along or unlink.
- On any Kyoto place, confirm **no move action is offered** — there is nowhere to move to.

## 5. Everything else names the visit (US4)

| Surface | Check |
| --- | --- |
| Search | Search `Tokyo`, then `Don Quijote` — results name which stay, and open it |
| Map | Trip scale offers both Tokyo visits separately; city scale plots only that visit's places |
| Export | `share` and `full` both render two Tokyo sections in journey order, neither repeating the other's places |
| Day plan | An activity on 14 Oct links to the second Tokyo, one on 20 Sep to the first |
| Breadcrumbs | Deep inside the second visit, going up returns to the second, not the first |

## 6. Visibility is unchanged (FR-020, SC-007)

Sign in as a member whose view hides stays. On **both** visits: no stays, and the stay count absent rather than zero — a zero would say a booking exists. Confirm no per-visit total can be differenced against another to infer one.

## 7. Deleting a visit keeps its content (FR-011)

Remove the second Tokyo stop from the journey. Expect a warning naming what it holds and the offer to move it to the other visit. Decline, delete, and confirm the places are still findable in search and no file was lost.

## Server tests worth running alone

```
npx vitest run server/tests/split-visits.test.ts
npx vitest run server/tests/steps-visits.test.ts
npx vitest run server/tests/visit-move.test.ts
npx vitest run server/tests/export.test.ts   # the no-duplication assertion
npx vitest run -t "second visit"
```

## Deploying

1. Apply migration `0023_zone_city_key.sql` to the live Supabase project by hand (SQL editor or the Supabase MCP `apply_migration`) — **committing it is not deploying it**, and every zone read expects `city_key` to exist.
2. `npm run split:visits` against Supabase, dry run first, and keep the journal.
3. Only then deploy the app.

Reversed, the deployed app 500s on its first zone read while every test still passes, because tests use the memory store.
