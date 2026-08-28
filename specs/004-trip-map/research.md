# Phase 0 Research: Map

Everything the plan asserts about the existing code was read out of the repository rather than assumed; the line references are the evidence. Each decision records what was rejected, because the rejections are the part that stops being obvious in three months.

---

## R1 — The server already sends what the map needs. No new endpoint.

**Decision**: build both scales out of two calls that already exist. `GET /api/trips/:tripId/zones/:zoneId/places` with no `category` for the zone map; the trip bundle's `steps[].zone` for the whole-trip map. Add no endpoint.

**Rationale**: `listZonePlaces` (`server/src/services/zones.ts`) already treats an empty category as "every category", already returns `lat` and `lng` per place, and already drops stays when the caller's view withholds them:

```ts
// category === '' means "every category" (used by the city map, which plots
// all of a zone's places and filters client-side).
const places = includeStays ? all : all.filter((p) => !isStay(p))
```

and `stepView` (`server/src/lib/step-view.ts`) spreads the whole zone row onto each journey step, so the bundle already carries all 9 zones' coordinates. The spec's brief allowed a map endpoint "if payload size argues for it": 39 places at roughly 200 bytes is about 8 KB for the largest zone sweep, against a bundle the app already fetches. It does not argue for it.

**Consequences worth stating**: FR-016 is therefore not new work — it is an existing behaviour that this feature must not undo. That is why Slice B's server-side change is a test file and a compile-time guard rather than a filter.

**Alternatives considered**:

- _`GET /api/trips/:tripId/map`, one payload for both scales._ Rejected: a new route is a new place to forget the `TripView` treatment, and it would duplicate a projection that already exists. The rule in `CLAUDE.md` — a new route inherits the access check, not the view — is exactly the trap.
- _Widening the trip bundle to carry every place._ Rejected: it would grow the payload on every screen to serve one, and the bundle is what a cold serverless function already spends its time on.

---

## R2 — Coordinates arrive by script, then by form. Never by request.

**Decision**: a one-off `scripts/backfill-coords.ts` for the 39 existing places, then `resolvePlaceLocation` in the place form for every place after that.

**Rationale**: Nominatim's usage policy allows one request per second. 39 places is 39 seconds in a script and impossible inside a Vercel Hobby function, which would also be doing it on a request that a traveller is waiting for. The service that talks to Nominatim already exists (`server/src/services/geocode.ts`), already sends the `User-Agent` the policy requires, and already biases results by a lat/lng — and every zone has coordinates to bias with, which is what makes an unqualified place name like "Ramen Bar" resolve inside the right city.

**The reversibility design** (the one production write in this feature):

- `--dry-run` is the default; `--apply` is explicit.
- Every write is journalled to `scripts/.backfill/<timestamp>.json` as `{ id, name, before: {lat,lng}, after: {lat,lng} }`.
- `--revert <journal>` restores `before` for every row in it.
- Idempotent: a place that already has coordinates is skipped, so re-running is safe and resumable after an interruption.
- Every place it could not resolve is printed by name (FR-002), which is the difference between a gap and a silence.

**Alternatives considered**:

- _An admin route that backfills on demand._ Rejected on the rate limit alone, and it would put a slow, externally-dependent write behind an HTTP timeout.
- _A migration with hard-coded coordinates._ Rejected: it would put 39 hand-checked literals into version control, be wrong the moment a place is edited, and turn a data fix into a schema change — losing the "no migration, nothing to roll back" property that makes this feature safe.
- _Geocoding silently on save._ Rejected by the user's clarification, and rightly: address lookup returns something plausible for almost any input, so a silent wrong pin is indistinguishable from a right one until someone walks to it.

---

## R3 — Leaflet, behind a port. No React wrapper.

**Decision**: `leaflet` (~42 KB gzip) with free OSM raster tiles, imported by exactly one module (`src/map/engine.leaflet.ts`) that implements a `MapEngine` interface. No `react-leaflet`.

**Rationale**: Leaflet is the smallest mature raster-tile map with no key and no account, which is what the $0 constraint requires. `react-leaflet` adds a second dependency, a peer-version coupling to React, and a component tree whose lifecycle is harder to reason about than six imperative calls — and it would not remove the real problem, which is that a map cannot mount in jsdom. The port solves the testing problem and the swap problem at once: everything above it is tested against `engine.fake.ts`, and replacing Leaflet with MapLibre is one file.

**Alternatives considered**:

- _Google Maps as the base map._ Rejected: it needs a billing account, which breaks the project's hard $0 rule. Deep links _out_ to it are free and are what US3 uses.
- _MapLibre GL + a free vector style._ Rejected for now: ~200 KB, WebGL, and free vector styles come with their own key or their own terms. The port means this is a reversible decision rather than a permanent one.
- _`react-leaflet`._ Rejected as above.
- _An `<iframe>` embed of OSM._ Rejected: no control over pins, and the site's own `X-Frame-Options`/CSP posture argues against building on frames.

---

## R4 — Tiles are never precached, and that is a requirement, not an optimisation.

**Decision**: no map imagery in the Workbox precache and no `CacheFirst` runtime rule that would accumulate tiles. With no network, the map screen renders the same pins as a list and says why (FR-026).

**Rationale**: the OSM tile usage policy forbids bulk downloading, and a precache is bulk downloading by definition. Independently, every byte in the precache manifest is a byte every phone downloads at install — the reason `vite.config.ts` already carries `globIgnores` for jsPDF's unreachable chunks. The offline story is therefore honest rather than magical: the places are local (TanStack Query's `NetworkFirst` cache already holds the zone response), the imagery is not, and the screen says so.

**Consequence**: `src/map/` is dynamically imported like `src/export/`, but unlike `src/export/` it is _not_ added to the precache — precaching a map whose tiles cannot come with it buys install weight and no offline capability.

**Alternatives considered**:

- _A small `CacheFirst` tile cache for the current zone._ Rejected: still bulk fetching under the policy, and it makes "does the map work offline" depend on where the traveller happened to pan yesterday — a worse answer than a clear no.

---

## R5 — The site currently forbids its own pages from asking where you are.

**Decision**: change one value in `vercel.json` — `geolocation=()` becomes `geolocation=(self)`.

**Rationale**: `Permissions-Policy: geolocation=()` denies the API to _every_ origin including the document's own, not merely to embedded frames. The browser then rejects the call without a permission prompt, so "you are here" works on a dev server (which sends no such header) and fails on the deployed phone with nothing in the UI to explain it. `(self)` restores it for our own pages while still denying every embed — which is the posture the header was presumably meant to express.

**Why it is foundational rather than part of US2**: it is a production-only failure, invisible to every test, and it should be verifiable on the deployed site before the story that depends on it is written.

**Alternatives considered**:

- _Removing the `geolocation` entry entirely._ Rejected: absent means the default allowlist, which is `self` anyway but says nothing to a reader. Naming it documents the decision.
- _Fixing it inside US2's slice._ Rejected: it would make the one change that cannot be proven locally the last thing anyone looks at.

---

## R6 — Two scales are a strategy, not a branch.

**Decision**: `zoneScope(...)` and `tripScope(...)` in `src/map/scope.ts`, each returning the same shape: `{ pins, bounds, emptyMessage, onPinTap }`. The map opens on the current or next journey step's zone; where the trip has not started, the first step.

**Rationale**: the trip spans about 500 km, so one flat map puts every pin at a useless zoom — the reason for two scales at all. But the two differ in four places (what the pins are, how they are framed, what an empty view says, and what tapping does), and encoding that as `if (scope === 'trip')` spreads a single decision across the render, the bounds maths and the handler. Two functions returning one shape means `TripMap.tsx` renders without ever asking which scale it is on, and each scale is unit-testable with no React at all.

**Alternatives considered**:

- _Two separate routes/pages._ Rejected: the toggle is meant to be instant and to keep the traveller's place; two pages make it a navigation.
- _One function with a `scope` parameter and internal branches._ Rejected: identical behaviour, but the branches reappear in every function it calls.

---

## R7 — The location picker already exists once. It should not exist twice.

**Decision**: extract the debounced destination autocomplete from `src/pages/JourneySteps.tsx` into `src/components/LocationPicker.tsx`, and consume it from both the journey editor and the place form.

**Rationale**: the journey editor already implements exactly the interaction the user's clarification asks for — type, debounce 450 ms, list real candidates, require an explicit pick, keep the existing value if the field is untouched. Writing a second one in `PlaceForm` would be a copy that drifts. Extracting is a behaviour-preserving refactor already covered by `src/tests/journey-editor.test.tsx`, which is what makes it safe to do first.

**Sequencing**: extract with the existing tests green, _then_ consume in `PlaceForm`. Doing it the other way round means debugging a new feature and a refactor at the same time.

**Difference to absorb**: the journey editor searches for cities and biases by nothing; the place form searches name + address and biases by its zone's coordinates. That is a prop, not a fork.

---

## R8 — Six tabs: shorten labels as a function of count.

**Decision**: `navLabels(tabCount)` in `src/lib/nav-labels.ts` returns today's labels for five tabs or fewer and short ones — Alerts, Info, Docs — at six. `Layout.tsx` builds its tab list first and asks.

**Rationale**: the bar is fixed, cannot scroll, and already carries up to five (`Shopping` and `Documents` are conditional). A sixth gives each about 57 px at 375 px and less at 320 px, where the current labels stop being readable. Making the shortening a _consequence of the count_ rather than a separate edit means the flag is a total rollback: with `show-map` off there are at most five tabs, so today's labels return with nothing to undo. It also means a member whose view already drops Documents keeps the long labels even with the map on, because they only have five.

**Honest limit**: no jsdom test can prove a label is legible at 320 px. The automated test asserts which label set is chosen for a given tab count; legibility is a step in `quickstart.md` at both widths, and SC-006 is verified there.

**Alternatives considered**:

- _Icons only at six._ Offered to the user and not chosen.
- _Shortening the labels unconditionally._ Rejected: it renames tabs for people who never see the map, and it survives the rollback.

---

## R9 — Analytics carries the shape of the map, never its contents.

**Decision**: declare `map_opened { scope, pin_count, missing_coords }` and `map_pin_opened { category }` in `src/lib/analytics-events.ts` before the call sites exist.

**Rationale**: `capture` is typed against that catalogue, so an undeclared event will not compile — the mechanism `CLAUDE.md` describes as the only thing that notices a broken analytics call. `sanitizeProperties` would strip a stray `name` or `address` at runtime anyway, but the point is not to write one.

**A coordinate is content.** It is not sent, on either event. A latitude and longitude pair names a hotel more precisely than the hotel's name does, and the questions these events exist to answer — is the map used, at which scale, how much is missing — need counts, not positions.

---

## R10 — What "directions" means

**Decision**: add `directionsUrl(...)` beside the existing `placeMapsUrl` in `src/lib/maps.ts`.

**Rationale**: `placeMapsUrl` builds a Google Maps _search_ link, from which Directions is one more tap — fine on a place detail page, one tap short of what FR-011 asks for from a pin. `https://www.google.com/maps/dir/?api=1&destination=…` opens the route directly, is a documented deep link, is free, and needs no key. It takes coordinates when the place has them and falls back to the same text query when it does not, so it works for a place the backfill could not resolve.

**Alternatives considered**:

- _Reusing `placeMapsUrl` unchanged._ Rejected against SC-008's two-tap budget.
- _Detecting the platform and emitting Apple Maps links on iOS._ Rejected as unrequested scope; the Google deep link opens the installed app on both platforms.

---

## R11 — The arrangement: 2a, full-bleed explore

**Decision**: build `map-2a-full-bleed-explore.png`. The map owns the screen; a peeking bottom sheet carries the category chips and a horizontal row of place cards; a floating top bar carries the search field and the scale toggle; a legend card floats over the map.

**Rationale**: chosen by the user from the three the design file offers. It is the arrangement that makes "browse in space" the point of the screen rather than half of it — which is the job the feature exists for, the 6pm-in-Shibuya problem where the map _is_ the answer and the list is the fallback.

**What it costs, stated plainly**: the saved-places list is never fully visible — it is a horizontal row in a peeking sheet. Two requirements lean on that list, and both are handled rather than assumed:

- **FR-019, the missing count**, gets a line of its own under the chips rather than a card at the end of the scrolling row. A count you have to scroll sideways to find is not "stated on the map".
- **FR-026, offline**, expands the sheet to full height and turns the card row into a vertical list with the explanation above it. This is 2b's arrangement borrowed for the one state where the map genuinely cannot be the answer — which is the right time to borrow it.

**Alternatives considered**:

- _2b · split map + list._ Its "Tokyo" / "Whole trip ›" header is FR-008's toggle drawn exactly, and its permanent list would have made FR-019 and FR-026 nearly free. Rejected in favour of 2a: the map is only ever half a screen, and it has no category filter at all, so FR-010's chips would have had to be invented into it anyway.
- _2c · city chapters._ Whole-trip as the default view contradicts FR-008, which opens on the current step's zone, and puts the pins one extra tap away on a single-city day. Its cluster treatment is kept for the `Trip` scale (see the plan's departure 6), which is where it was always the right answer.
- _A synthesis of all three._ Considered and offered; the user picked a single direction, which is the better outcome — a screen assembled from three references reads as none of them.

---

## R12 — Ship on the stock palette; route every colour through `CATEGORY_META`

**Decision**: no `tailwind.config.ts` change. `CATEGORY_META` gains a `dot` field using stock Tailwind classes (`bg-violet-500`, `bg-sky-500`, `bg-amber-500`, `bg-pink-500`, `bg-emerald-500`), and pins, chips, legend swatches and card dots all read from it.

**Rationale**: the reference renders were made against the redesign's category palette — slate blue, olive, terracotta, ochre — which arrived with PR #93 and was reverted with it in PR #94. `main` carries stock violet/sky/amber/pink. The user chose to ship on those rather than pull redesign tokens into this feature.

**So the map's arrangement will match the reference and its hues will not**, until spec 009 re-lands. That is a stated, accepted difference, not an oversight — and worth checking against the render at review time so nobody "fixes" it back.

**What keeps it cheap to correct**: one table. Because no map file names a colour, re-landing 009's palette recolours the pins, the chips, the legend and the card dots in a single edit to `CATEGORY_META`, with no map code touched. The alternative — a `MAP_PIN_COLOURS` constant inside `src/map/` — would have been marginally simpler now and would have guaranteed the map drifted out of step with every other surface that shows a category.

**Alternatives considered**:

- _Lift the four category colour pairs out of the reverted commit._ Ten lines, additive, and the map would match the render exactly. Not chosen: it starts re-landing a reverted redesign from inside an unrelated feature, and a token change is not revertible with this feature's commits.
- _Take the whole reverted token set_ (neutral ramp, Bricolage Grotesque). Rejected as spec 009's work — it restyles every existing screen and would make this feature impossible to revert alone.
- _Block on 009._ Rejected: it makes a shippable feature wait on a spec that was just reverted and has no date.

---

## R13 — Two labels, one search field, and what the render could not decide

Three small decisions the render leaves open, recorded because each is the kind of thing that gets silently "corrected" later.

**The segments say `City` / `Trip`, not `Day` / `Trip`.** 2a's left segment reads "Day", which in 2b's vocabulary means scoping pins to one date. No requirement here asks for day-scoping; FR-008 defines the scales as the current step's zone and the whole trip. The control keeps its position, its shape and its styling; only the word changes, because the word was describing a different feature.

**The search field routes to the existing `/search`.** The render cannot say what "Search Japan…" searches. Map-specific search is not in any FR, and a field that does nothing is worse than one that does something adjacent. Consequence accepted: this screen offers two routes into search, since the app header already carries a magnifier — cosmetic, on a header spec 009 restyles anyway. _Client-side pin filtering by name was considered_ — cheap over 39 places, genuinely useful on a map — and rejected as behaviour no FR carries; it belongs in a follow-up, not smuggled in through a design render.

**The sheet is not doubled for US3.** The original plan had a `PinSheet` overlay for a tapped pin. 2a already has a sheet, so a second one would cover the first. Tapping a pin instead scrolls `PlaceCardRow` to that place and expands its card into the summary, the place link and the directions link — one sheet with two states, which is what the render's card row is already shaped for.
