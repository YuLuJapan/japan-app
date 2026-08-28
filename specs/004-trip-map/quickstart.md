# Quickstart: proving the Map works

How to verify each slice, in the order it ships. Every step names what should happen; a step that does something else is a defect, not a surprise.

## Prerequisites

```bash
npm install          # adds leaflet + @types/leaflet from Slice B onward
npm run dev          # web on :3000, API on :3001
```

Local dev uses the in-memory store seeded from `server/src/data/placeholder-data.json` — 39 places, 9 zones, and edits that live until the process restarts. That is the right place to try the backfill: it cannot touch anything permanent.

The map is behind `show-map`, which **defaults off**. With no `VITE_POSTHOG_PROJECT_TOKEN` there is no answer, so the default applies and the map is invisible in local dev. To work on it, flip the default to `true` in the two call sites (`src/components/Layout.tsx` and the `RequireMap` guard in `src/router.tsx`) and flip it back before committing — the same dance `export-trip` already needs.

## The whole gate, before any commit

```bash
npm test            # both projects
npm run typecheck   # not optional — the field policy fails here, not in the tests
npm run lint
npm run format
```

`npm test` transpiles types away, so it cannot see the field-policy guard. That guard is the point of Slice B's server change, and `typecheck` is the only thing that runs it.

---

## Slice A — coordinates, and permission to ask

### A1. The backfill, dry first

```bash
npm run backfill:coords            # dry run: prints what it would write, changes nothing
npm run backfill:coords -- --apply # writes, and journals every write
```

Expect: one line per place, about one per second; every resolved place showing the coordinates and the matched name it would store; a closing summary of resolved / skipped / **unresolved by name** (FR-002). A silent unresolved place is the failure this step exists to prevent.

**Verify the reversibility before trusting it** — on the memory store, where it costs nothing:

```bash
npm run backfill:coords -- --apply           # note the journal path it prints
npm run backfill:coords -- --apply           # second run: "39 skipped, already located" — idempotent
npm run backfill:coords -- --revert scripts/.backfill/<timestamp>.json
```

After the revert, every place is back to `lat: null`. If that does not hold, the script is not ready to point at production.

### A2. Sanity-check the results, do not assume them

Address lookup is confident about wrong answers. Spot-check a handful against the zone they belong to: a Kyoto place with a Tokyo latitude is the failure mode, and it looks exactly like a success in the log. The journal makes a bad batch one command to undo.

### A3. Geocode-on-save

Open a zone → add a place with a name and an address → save.

Expect: candidates offered, where the chosen one landed shown before it is stored, and nothing stored until it is accepted. Then: decline every candidate and save — the place saves with no location (FR-004). Then: save a place with no address at all — no lookup is attempted, and it joins the missing count rather than being blocked or guessed at.

### A4. The journey editor still works

The picker was extracted from it. `src/tests/journey-editor.test.tsx` must pass unchanged — that is what makes the extraction a refactor rather than a rewrite.

### A5. The header, which only production can prove

`vercel.json` sends `geolocation=(self)` instead of `geolocation=()`. Locally this is invisible: the dev server sends no such header, which is exactly why the bug survived. On a preview deployment:

```bash
curl -sI https://<preview>.vercel.app/ | grep -i permissions-policy
# expect: ...geolocation=(self)...
```

Then, on a phone, from the deployed preview: the map's "where am I" asks for permission. **A prompt appearing is the pass.** No prompt and no error is the original bug.

---

## Slice B — the zone map (the MVP)

### B1. Pins and filters

Open a zone → Map. Expect every located place in that zone as a pin, categories visually distinct, all of them in frame on open. Toggle a category off: only its pins go. Toggle it back: they return. No request is made for either — the filter is client-side over a list already fetched.

### B2. The withheld-stays check, on the wire

This is the one to do properly, because the screen is not the control.

1. Share the trip with a viewer whose `can_see_stays` is off.
2. Sign in as them, open a zone with hotels in it, open the map.
3. In devtools → Network, open the response for `zones/<id>/places`.

Expect **no object with `"category": "hotel"` in the JSON**. Not hidden, not filtered later — absent. Also expect no hotel chip, which is the courtesy half.

`server/tests/map-pins.test.ts` asserts the same thing on the response body, so this manual pass is a confirmation rather than the guarantee.

### B3. Nav labels at six tabs

With the map on, an owner sees six tabs: labels shorten (Alerts, Info, Docs). Check at **375px and at 320px** in devtools: every label fully readable, nothing truncated mid-word, nothing overlapping. This is SC-006, and it is verified here rather than in jsdom, which cannot measure text.

Then turn `show-map` off: five tabs, and today's labels return with nothing else changed. That is lever 4 of the rollback plan, and it is worth seeing work.

A viewer whose view drops Documents has five tabs even with the map on, and keeps the long labels.

### B4. Offline

Devtools → Network → Offline, then open the map on a trip already loaded.

Expect the places as a list plus a plain statement that the map needs a connection. Not a grey square, not a spinner, not an error screen (FR-026).

### B5. The entry bundle did not move

```bash
npm run build
```

The entry chunk stays around 233 KB gzip; Leaflet and `src/map/*` appear as separate chunks. If the entry chunk grew, something imported the engine statically — find it before shipping.

---

## Slice C — you are here, and the way out

### C1. Position

Open the map, ask for position, grant it: a marker distinct from the place pins, and the map moves to include it. Deny it: the map stays fully usable, says the position is unavailable, and does not ask again in that visit (FR-023). Then set a location far from the zone in devtools' sensors panel: the saved places stay framed, with a way to move to your own position — the map does not zoom out to span both (FR-025).

### C2. Pin → place → directions

Tap a pin: the summary matches that place. Follow the place link: its own screen. Follow directions: an external maps app opens with that place as the **destination**, not as a search. Come back: the map is where you left it.

Count the taps from spotting a pin to directions. Two is the budget (SC-008).

---

## Slice D — the whole trip, and what is missing

### D1. Both scales

Switch to whole-trip: one pin per zone, all in frame, each labelled with how many located places it holds. Tap one: the map moves to that zone's places at a useful scale. Reopen the map fresh: it opens on the current or next step's zone, not on the whole trip. On a trip that has not started, that is the first step.

### D2. The missing count

With at least one place lacking a location: the count is stated on the map. Tap it: exactly those places, by name. Tap a row: that place's edit screen, where the picker from Slice A sets a location. Fix it and return: the count drops by one and a pin appears.

As a viewer who cannot edit: the same count, stated honestly, leading nowhere (FR-021).

With every place located: nothing about missing places is shown at all (FR-019's fourth scenario).

### D3. The arithmetic

Pins on screen + the missing count = the places that member can see in that view. Check it in a zone with a hidden stay too, where "can see" is the smaller number. That is SC-004, and it is the one number that proves the map is not quietly under-reporting.

---

## Rolling back

In rough order of cost, all of them tested rather than assumed:

1. **Turn `show-map` off in PostHog.** The tab goes, the route redirects, the labels return. No deploy. Confirm with a bookmarked `/trips/<id>/map` — it should redirect, not render.
2. **Revert one slice's commit.** Each leaves the app working; the dependency order is A → B → C/D, so C and D revert freely and B reverts once nothing references it.
3. **Revert the backfill**: `npm run backfill:coords -- --revert <journal>`.
4. **Revert the header**: one value in `vercel.json`.
5. There is no migration, so there is nothing else.
