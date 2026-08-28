# Feature Specification: Map

**Feature Branch**: `claude/task-004-monday-y5ra89`

**Created**: 2026-08-28

**Status**: Draft

**Input**: Monday board "Onward — Next Four", group `004 · Map` — feature brief and spec-input updates on item "◆ FEATURE — Map", plus the foundational item and five user-story items. Feature description: "See everything you saved in space rather than in a list, so you stop leaving the app for Google Maps. Standing in Shibuya at 6pm deciding what is near, the app answers 'what did we save' but never 'what is close'. Opens on the current journey step's zone, with a whole-trip toggle. Starts with a coordinate backfill: 0 of 39 places have coordinates, all 9 zones do. Sixth nav tab behind a flag defaulting off. One tap out to an external maps app for turn-by-turn." Clarifications settled with the user before writing: sixth bottom-nav tab with shortened labels at six; whole feature in scope (foundational slice + five stories); geocode-on-save suggests a location and the traveller confirms it; missing coordinates surface as a count that leads to a list and then the existing place edit form.

## User Scenarios & Testing _(mandatory)_

### Foundational Work - Every place has a location (Priority: Foundational — blocks every story below)

Today not one saved place carries a location, while every zone does. A map built before this lands shows nine city dots and none of the thirty-nine places the trip is actually made of — the feature would look finished and answer nothing. Two further things have to be true before any story can be believed: existing places get locations in one pass, and newly added places get one at the moment they are saved, so the gap never reopens.

There is a third: the deployed site currently tells the browser that this page may not ask for the traveller's position. Nothing reports that — the request simply never resolves — so "you are here" works on a laptop in development and fails silently on the phone that needs it.

**Why this priority**: It is not a story a traveller can be shown, and every story below is a lie without it.

**Independent Test**: Run the backfill and confirm that all 39 existing places carry a location and that each one lands within its own city; add a new place through the form and confirm it acquires a location without a separate errand; load the deployed site and confirm the position request reaches the traveller as a permission prompt rather than failing unreported.

**Acceptance Scenarios**:

1. **Given** a trip whose places have no locations, **When** the backfill is run, **Then** each place that can be resolved carries a location, each one that cannot is listed by name for a human to handle, and running it a second time changes nothing already correct.
2. **Given** a traveller adding or editing a place with a name and an address, **When** they save it, **Then** the system offers the location it resolved, shows where that is, and lets them accept it, choose a different match, or save without one.
3. **Given** the deployed site, **When** the map asks for the traveller's position, **Then** the browser asks the traveller rather than refusing on the site's behalf.

---

### User Story 1 - See this city's places on a map and filter by type (Priority: P1)

A traveller standing in a city opens the map and sees the places they saved there as pins, and can narrow to just food, or just attractions, to decide what is near without leaving the app.

**Why this priority**: This is the job the feature exists for, and it ships alone as the MVP — the other four stories make it better, none of them make it work.

**Independent Test**: Open the map while in a zone, confirm a pin for every place in that zone that has a location, toggle a category off and confirm those pins go, toggle it back and confirm they return. Then open the same map as a member who cannot see stays and confirm no hotel pin is present and no hotel filter is offered.

**Acceptance Scenarios**:

1. **Given** a zone with places of several categories, **When** the traveller opens the map, **Then** every one of that zone's located places appears as a pin, distinguishable by category, and the view is framed so all of them are visible at once.
2. **Given** the map with all categories shown, **When** the traveller turns one category off, **Then** only that category's pins disappear and the others are untouched.
3. **Given** a member whose view withholds stays, **When** they open the map, **Then** no hotel pin is present in what the system sends them, and no hotel filter is offered.
4. **Given** a zone in which every place is missing a location, **When** the traveller opens the map, **Then** the screen says so plainly instead of showing an empty city.

---

### User Story 2 - See where I am relative to what I saved (Priority: P2)

A traveller on the street wants their own position on the map, so "near" means near them rather than near the city centre.

**Why this priority**: It converts the map from a plan into a tool you use while standing up, but the map is useful without it.

**Independent Test**: Grant the location permission and confirm a marker for the traveller's own position appears and the map moves to include it; deny it and confirm the map is still fully usable and says what was declined.

**Acceptance Scenarios**:

1. **Given** a traveller who grants permission, **When** their position is determined, **Then** a marker distinct from the place pins shows it and the map centres to include it.
2. **Given** a traveller who declines permission, or whose device cannot determine a position, **When** the map opens, **Then** it works exactly as before, states that the position is unavailable, and does not ask again unprompted.
3. **Given** a traveller whose position is far outside the zone being shown, **When** their position is determined, **Then** the map does not zoom out to span both — the saved places stay the subject, with a way to move to their own position.

---

### User Story 3 - Go from a pin to the place, or to directions (Priority: P2)

A traveller who has spotted something on the map wants to open its details, or get walking directions to it, so the map is a way in rather than a dead end.

**Why this priority**: Without it the map shows you something and then strands you; with it the map is the entry point to everything else the app already holds.

**Independent Test**: Tap a pin, confirm the summary shown matches that place, follow the link to the place's own screen, and follow the directions link and confirm it opens an external maps app pointed at that place.

**Acceptance Scenarios**:

1. **Given** a map with pins, **When** the traveller taps one, **Then** a summary of that place appears without leaving the map, showing at least its name, category and address.
2. **Given** that summary, **When** the traveller chooses to open the place, **Then** they arrive on that place's own screen.
3. **Given** that summary, **When** the traveller chooses directions, **Then** an external maps application opens with that place as the destination, and returning to the app leaves the map where they left it.

---

### User Story 4 - See the whole trip's cities and zoom into one (Priority: P3)

Someone planning wants the shape of the whole journey on one map — every stop, in order — so they understand how far apart things are, then to drop into one stop.

**Why this priority**: Valuable when planning rather than travelling, and it works on day one because every zone already has a location.

**Independent Test**: Switch to the whole-trip view and confirm one pin per zone with all of them in frame, then tap one and confirm the map moves to that zone's places.

**Acceptance Scenarios**:

1. **Given** a trip with several stops, **When** the traveller switches to the whole-trip view, **Then** one pin appears per zone, labelled and carrying how many located places it holds, framed so every stop is visible.
2. **Given** the whole-trip view, **When** the traveller taps a zone pin, **Then** the map switches to that zone's places at a useful scale.
3. **Given** the map is opened fresh, **When** the trip is under way or about to be, **Then** it opens on the current or next journey step's zone rather than on the whole trip.

---

### User Story 5 - Know which places are missing from the map (Priority: P3)

A traveller wants to be told when a saved place has no location yet, so the map never quietly under-reports what they saved.

**Why this priority**: It protects trust in the map. Its absence turns a data gap into a silent lie, which is worse than the gap.

**Independent Test**: With at least one place lacking a location, open the map and confirm the count is stated, that opening it lists exactly those places, and that a row leads to where the place's location can be set.

**Acceptance Scenarios**:

1. **Given** a zone in which some places have no location, **When** the map is shown, **Then** the number of places absent from the map is stated on the map itself.
2. **Given** that statement, **When** a traveller who can edit taps it, **Then** they get the list of exactly those places, and a row takes them to that place's edit screen where a location can be set.
3. **Given** a member who cannot edit, **When** they see the count, **Then** it is stated honestly and leads nowhere, rather than being hidden or offering an action that would fail.
4. **Given** every place in view has a location, **When** the map is shown, **Then** nothing about missing places is stated at all.

### Edge Cases

- **The site denies itself the position API.** The deployed site currently sends a policy that blocks the page — not just embedded content — from asking for the traveller's position. The request never resolves and nothing is reported, so this passes every test in development and fails on the phone. Fixed as foundational work, not as part of US2.
- **A hidden stay's pin.** A member whose view withholds stays must not merely be shown no hotel filter; the pins must never be sent to their device. The chip not rendering is courtesy, what is transmitted is the control.
- **A place with no location.** Never silently dropped. Counted, listed and routed to a fix.
- **No signal.** Map imagery needs a network. With none, the screen must show the places as a list and say why the map is not drawn, rather than a grey square. Imagery is not stored ahead of time — it would cost storage on every phone and is against the imagery provider's terms.
- **A sixth item in the bottom bar.** The bar already carries up to five, and two of those are conditional. Six items give each about 57px on a 375px-wide phone, where the longest current label stops being readable; 320px is tighter still, and the bar is fixed so it cannot scroll out of trouble. Labels shorten when six are present.
- **The scale problem.** The trip spans roughly 500km; one flat map of all of it puts every pin at a zoom where none of them is useful. Hence two scales and a default that opens on where the traveller actually is in the trip.
- **A location that resolves to the wrong place.** Address lookup returns something plausible for almost any input. The traveller sees where the suggestion landed before it is saved, and can reject it.
- **A place saved with no address at all.** There is nothing to resolve; the place saves without a location and joins the missing count rather than being blocked or given a guess.
- **The flag has no answer yet.** The map is behind a flag that defaults off, and the default is what is used when no answer has arrived. On a device's first run the tab is absent until the flag service answers, and stays absent if that request fails.

## Requirements _(mandatory)_

### Functional Requirements

#### Locations on places (foundational)

- **FR-001**: The system MUST provide a repeatable, offline-run backfill that resolves a location for every existing place from what the place already carries, respecting the rate limit the free lookup service requires, and MUST be safe to run more than once.
- **FR-002**: The backfill MUST report every place it could not resolve, by name, rather than leaving them indistinguishable from places it never tried.
- **FR-003**: When a place is created or edited with an address, the system MUST resolve a candidate location and present it to the traveller for confirmation, showing where the candidate is, and MUST NOT store a location the traveller has not accepted.
- **FR-004**: A traveller MUST be able to save a place without a location — by declining every candidate, or because there was nothing to resolve — and the place MUST save normally.
- **FR-005**: The system MUST NOT require a schema change to hold locations; places and zones already carry them.
- **FR-006**: The deployed site MUST permit its own pages to request the traveller's position. The site's own policy MUST NOT be the thing that denies it.

#### The map

- **FR-007**: The system MUST offer a map of the places saved in a single zone, showing one pin per located place, distinguished by category, framed so that every pin is visible when the map opens.
- **FR-008**: The map MUST open by default on the zone of the trip's current or next journey step, and MUST offer a whole-trip view showing one pin per zone.
- **FR-009**: From the whole-trip view, selecting a zone MUST move the map to that zone's places.
- **FR-010**: The traveller MUST be able to show and hide each place category independently, and only the categories actually present in the current view MUST be offered.
- **FR-011**: Selecting a pin MUST show a summary of that place — at least its name, category and address — without leaving the map, and MUST offer both a route to that place's own screen and a route to an external maps application with that place as the destination.
- **FR-012**: The map MUST be reachable as a sixth item in the trip's main navigation. When six items are present, their labels MUST shorten so that each remains readable at 320px; no item may be truncated mid-word or overlap its neighbour.
- **FR-013**: Map imagery MUST carry the attribution its provider's terms require, visible on the map itself.
- **FR-014**: The system MUST NOT store map imagery ahead of time for offline use.
- **FR-015**: The whole feature — the navigation item and its screen alike — MUST sit behind a flag that defaults off, such that turning the flag off removes the entry point _and_ closes direct navigation to the screen.

#### What the map may show

- **FR-016**: The system MUST NOT send a device any location for content that member's view withholds. Withholding is applied to what is transmitted, not to what is drawn. Today the flag that bites is stays; the rule is stated generally so anything later admitted to the map inherits it.
- **FR-017**: A filter for a category from which a member is withheld everything MUST NOT be offered to them.
- **FR-018**: The map MUST NOT be reachable for a trip the member does not belong to, and the attempt MUST be indistinguishable from that trip not existing.

#### Missing locations

- **FR-019**: Wherever the map shows places, the system MUST state how many places in that view have no location. It MUST NOT omit them silently.
- **FR-020**: For a member who can edit, that statement MUST lead to the list of exactly those places, and each row MUST lead to that place's existing edit screen. The system MUST NOT introduce a second place to set a location.
- **FR-021**: For a member who cannot edit, the count MUST still be stated and MUST NOT offer an action that would be refused.

#### The traveller's own position

- **FR-022**: The system MUST show the traveller's own position on the map when they permit it, distinguished from place pins, and MUST offer to move the map to it.
- **FR-023**: The system MUST NOT ask for the position until the traveller asks for it, and MUST NOT re-ask after a refusal within the same visit.
- **FR-024**: When the position is refused or unavailable, the map MUST remain fully usable and MUST say what is unavailable rather than failing silently or appearing broken.
- **FR-025**: Showing the traveller's position MUST NOT change the framing of the saved places when the traveller is far from the zone in view.

#### Degradation and reporting

- **FR-026**: With no network connection, the map screen MUST show the places it would have pinned as a list and state that the imagery is unavailable, rather than showing an empty or broken map.
- **FR-027**: The system MUST record that the map was opened and that a pin was opened, capturing only the shape of it — which scale, how many pins, how many places lacked a location, which category — and never any trip content.

### Key Entities

- **Place**: already carries a name, address, category and optional coordinates. This feature fills the coordinates and makes their absence visible; it adds no field.
- **Zone**: a stop on the trip; already carries coordinates. Supplies both the default framing for the zone map and the pins of the whole-trip view.
- **Journey step**: the trip's ordered stops with dates; decides which zone the map opens on.
- **Member view**: the per-member content permissions that already govern what a member may see; decides which pins are transmitted.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: After the backfill, 100% of the 39 existing places either carry a location inside the correct city or appear by name on the list of ones needing a human — 0 places are silently left out.
- **SC-002**: A traveller standing in a city can go from opening the app to seeing what they saved nearby on a map in under 10 seconds and at most two taps.
- **SC-003**: For a member whose view withholds stays, 0 hotel locations are present in what their device receives — verified against a zone containing hotels, by inspecting the transmitted data rather than the screen.
- **SC-004**: For any map view, the number of places shown as pins plus the number reported as missing a location equals the number of places that member can see in that view — 100% of the time.
- **SC-005**: A newly added place with an address acquires a confirmed location during the save, with no separate errand, in at least 90% of additions; the remainder save without one and are counted rather than blocked.
- **SC-006**: On a 320px-wide screen with all six navigation items present, every label is fully readable — 0 truncated or overlapping labels.
- **SC-007**: With the network disabled, opening the map for an already-loaded trip shows the full list of places and an explanation in 100% of attempts, and never a blank or broken map.
- **SC-008**: A traveller can get from spotting an unfamiliar pin to turn-by-turn directions in an external maps app in at most two taps.
- **SC-009**: Opening the map on the deployed site and permitting location produces a position marker in 100% of attempts on a device with location available — the site's own policy denies 0 of them.
- **SC-010**: Turning the flag off removes the map entirely: 0 entry points remain and direct navigation to the map does not open it.

## Assumptions

- The screen's arrangement follows a design reference the Monday item supplied after this spec was written — option **2a · Full-bleed explore** from `Onward Redesign Options.dc.html`, chosen by the user from three. The renders are committed at `reference/`, and how the build follows and departs from them is the plan's business, not this spec's: every requirement below is about behaviour and holds under any of the three arrangements.
- Coordinates already exist as fields on both places and zones, so this is a data and interface feature, not a schema change.
- The free address-lookup service already used elsewhere in the app is adequate for the backfill and for confirming a location on save; its rate limit is what forces the backfill to run outside a request.
- All 9 zones' existing coordinates are correct, so the whole-trip view works before the backfill runs.
- Free map imagery is available under terms requiring attribution and forbidding bulk pre-fetching; no paid mapping account is introduced, in keeping with the project's zero-cost constraint.
- Turn-by-turn navigation stays with the external maps app the traveller already uses; the app's map is for overview and does not attempt routing.
- The trip's journey steps and dates are sufficient to decide which zone is "current or next"; where the trip has not started, the first step is used.
- The existing place edit screen is the single place a location is set or corrected, both for new places and for fixing a bad backfill result.
- Flag behaviour follows the app's existing rule: the default applies when no answer has arrived, so the map is invisible on a device's first run until flags load. **The code default stays `false` permanently — decided rather than deferred: the map appears only where `show-map` has been turned on explicitly in PostHog, and no later change flips the default to `true`.** The consequences are accepted: the map is invisible in local dev and on any deploy without analytics configured, and a device that never receives flags never sees the tab.
