# Feature Specification: Separate pages for repeated cities

**Feature Branch**: `claude/separate-repeated-cities-hyncd7`

**Created**: 2026-08-29

**Status**: Draft

**Input**: User description: "When a user goes to one same city more than once in their trip, it should be displayed as totally separated city. E.g.: in the japan trip we go to tokyo twice, and now is represented in the same city page. I want to see them separately."

## Context

A trip is a sequence of **stops**: a city, and the dates spent there. Today a stop names a city, and a city holds everything the traveller has collected for it — the places, the tips, the photo, the documents and the category tallies.

When a trip returns to a city, the journey shows two stops but both open **one** city page. In the Japan trip, Tokyo is stop 1 (19–25 September) and stop 10 (12–16 October); both open the same Tokyo page, whose lists pool everything from both stays. The list of stays shows one hotel where there are two nights' worth of different bookings; a restaurant booked for the last night sits in the same list as the first morning's coffee shop; the tips for arriving in Tokyo sit next to the tips for the final day before the flight home.

The day plan is the one surface that already gets this right, because an activity carries a date and each date belongs to exactly one stop. Everything else conflates the two stays.

This feature makes each visit to a city its own thing: its own page, its own place lists, its own tips, its own tallies. A city visited once is unaffected.

## Glossary

- **City**: the destination itself — its name, its position on a map. "Tokyo".
- **Visit**: one stay in a city between two dates. Tokyo has two visits on the Japan trip. A city visited once has exactly one visit, which is why nothing changes for it.
- **Repeated city**: a city with more than one visit on the same trip.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Two stays in one city are two separate pages (Priority: P1)

The traveller opens the journey and sees Tokyo twice, as they always have. Tapping the first Tokyo opens a page holding only what belongs to 19–25 September; tapping the second opens a different page holding only what belongs to 12–16 October. Each page names which visit it is, so the traveller can tell at a glance which stay they are looking at, and neither page shows the other's places, tips or counts.

**Why this priority**: This is the whole request. Delivered alone, with content divided once and never moved again, the traveller already stops seeing the last night's restaurant in the first morning's list — which is the value asked for.

**Independent Test**: Open a trip that visits one city twice, open each visit in turn, and confirm the two pages show different content and that no place or tip appears on both unless it was deliberately put on both.

**Acceptance Scenarios**:

1. **Given** a trip that visits Tokyo 19–25 Sep and again 12–16 Oct, **When** the traveller opens the first Tokyo from the journey, **Then** the page shows only that visit's places, tips, documents and category counts, and identifies itself as the 19–25 September stay.
2. **Given** the same trip, **When** the traveller opens the second Tokyo, **Then** the page shows only the 12–16 October content, and the counts on it match what its own lists contain.
3. **Given** a trip that visits Kyoto exactly once, **When** the traveller opens Kyoto, **Then** the page is unchanged from before this feature — same content, same counts, and no visit label cluttering it.
4. **Given** a repeated city, **When** the traveller opens a category (for example Food) from one visit, **Then** the list holds only that visit's food spots, and the empty state for a visit with none says so rather than showing the other visit's.

---

### User Story 2 - New content lands on the visit you are looking at (Priority: P1)

The traveller is on the second Tokyo page, planning the last few days, and adds a ramen shop and a tip about leaving luggage at the station. Both land on the second visit. The first Tokyo page is untouched.

**Why this priority**: Without it, the split immediately decays: everything added after the split would have to be filed by hand, and within a day the pages would be pooled again. It is the same size of change as US1 and worthless separately, so both are P1.

**Independent Test**: From each visit in turn, add a place and a tip, then check both pages — each addition appears on exactly the visit it was added from.

**Acceptance Scenarios**:

1. **Given** the traveller is on the second Tokyo visit, **When** they add a place, **Then** it appears on that visit's list and its category count, and does not appear on the first visit.
2. **Given** the traveller is on the second Tokyo visit, **When** they add a tip, **Then** it appears only under that visit.
3. **Given** the traveller adds an activity to a day that falls inside the second Tokyo visit and links it to a place, **Then** only places belonging to that visit are offered to link to, and the day plan links through to the second visit's page.
4. **Given** the traveller uploads a document while on one visit, **When** they open the other visit, **Then** the document is not listed there.

---

### User Story 3 - Move a place or tip to the other visit (Priority: P2)

Having seen the two lists apart, the traveller notices the teppanyaki place they saved is actually for the last night, not the first week. They move it to the other Tokyo visit in one action, from the place itself, without retyping anything it holds.

**Why this priority**: The split is only as good as the filing, and the filing will be wrong somewhere on day one — particularly straight after the existing Tokyo content is divided. Without this the only remedies are deleting and retyping, or living with it. It is not P1 because the traveller can get real value from US1 and US2 before it exists.

**Independent Test**: Move a place from one visit to another and confirm it leaves the first page's list and count, arrives on the second's, and keeps its name, notes, links, photo, coordinates and attached documents.

**Acceptance Scenarios**:

1. **Given** a place on the first Tokyo visit, **When** the traveller moves it to the second, **Then** it disappears from the first visit's list and count and appears on the second's, with every field, link and attached document intact.
2. **Given** that place is linked to an activity on a day inside the first visit, **When** the traveller moves it to the second visit, **Then** they are told the link would cross visits before the move completes, and the day plan is never left pointing at a place from a different stay.
3. **Given** a city visited only once, **When** the traveller opens a place on it, **Then** no "move to another visit" action is offered, because there is nowhere to move it to.
4. **Given** a tip on one visit, **When** the traveller moves it to the other, **Then** it appears under the destination visit only.

---

### User Story 4 - Every surface names the visit, not just the city (Priority: P2)

Wherever the app lists cities — the search results, the map, the exported document, the breadcrumb above a place — a repeated city reads as two entries with their dates, not one ambiguous entry. Searching "Tokyo hotel" and finding two results tells the traveller which stay each belongs to.

**Why this priority**: The city page can be right while the rest of the app still pools the two visits, and a search result or an exported plan that cannot say which Tokyo it means recreates the original confusion somewhere else. It follows US1 rather than blocking it.

**Independent Test**: For each surface that shows a city (journey, search, map, export, breadcrumbs, day plan), confirm a repeated city appears once per visit with its dates, and a city visited once appears exactly as it did before.

**Acceptance Scenarios**:

1. **Given** a search that matches places from both Tokyo visits, **When** the results are shown, **Then** each result names which visit it belongs to, and tapping one opens that visit.
2. **Given** the map at trip scale, **When** the traveller filters or steps between cities, **Then** each visit is offered separately with its dates, and choosing one plots that visit's places.
3. **Given** an exported trip document, **When** the traveller reads it, **Then** the two Tokyo stays appear as two sections in journey order with their own dates and their own places, and neither section repeats the other's.
4. **Given** the traveller is deep inside the second Tokyo visit, **When** they read the breadcrumb, **Then** it names that visit, and going up returns to that visit rather than to the other one.

---

### Edge Cases

- **A city visited three or more times**: nothing about the rules is specific to two. Each visit is independent and labelled by its own dates.
- **Two visits with the same or overlapping dates** (a data error, or an editing intermediate state): both must still be reachable and distinguishable from each other, falling back to journey order ("first visit", "second visit") when dates cannot tell them apart.
- **Back-to-back visits** (one ends on the day the next begins): these are two visits, not one, and are not silently merged — a traveller who split a stay deliberately keeps the split.
- **A visit is deleted from the journey** while it still holds places, tips or documents: the content must not vanish silently. The trip's existing rule for deletes (a deleted place's documents are reparented to the trip rather than lost) is the precedent to follow.
- **A trip's dates change** so that a stop moves or is clipped: the visit keeps its content; only its dates change.
- **A stop's city is changed** to a different city on an existing visit: the traveller is told what content moves with it before it happens.
- **A member whose view hides stays** opens a repeated city: each visit hides its own stays and its own stay counts, exactly as one city does today. Splitting must not become a way to infer a hidden booking from a count.
- **Offline**: a visit page already opened must still open with no signal, as city pages do today.
- **A trip with no repeated city at all** — every existing trip but this one: the traveller sees no visit labels, no move actions, and no change of any kind.
- **A repeated city where one visit ends up empty**: the empty visit says it is empty and offers to add something, rather than borrowing the other visit's content to look full.

## Requirements _(mandatory)_

### Functional Requirements

**Separation**

- **FR-001**: The system MUST treat each visit to a city as a separate destination page, holding its own places, tips, documents and category counts.
- **FR-002**: The system MUST NOT show one visit's places, tips, documents or counts on another visit of the same city.
- **FR-003**: A city visited exactly once MUST behave and read exactly as it does today, with no visit label, no visit chooser and no move action.
- **FR-004**: Each visit MUST be reachable directly from the journey, and opening a stop from the journey MUST open that stop's own visit.
- **FR-005**: Each visit of a repeated city MUST identify itself by its dates, and MUST fall back to its order in the journey when two visits cannot be told apart by date.
- **FR-006**: A stop added to the journey for a city already on the trip MUST become a new, empty visit rather than reopening the existing one. (This reverses today's deliberate behaviour, which reuses the existing city when the name matches.)

**Content ownership**

- **FR-007**: A place, tip or document MUST belong to exactly **one** visit at a time. There is no shared listing across visits: a traveller who wants the same hotel or the same ramen shop on both stays saves it on each, and the two copies are then independent.
- **FR-007a**: Because a place belongs to one visit, every count, list and map at visit scale MUST be unambiguous — no item may be counted twice within one city, and no item may appear on a visit it does not belong to.
- **FR-008**: Content created while a visit is open MUST be filed against that visit.
- **FR-009**: The system MUST let the traveller move a place, tip or document from one visit of a city to another visit of the same city, preserving every field it holds, including its links, photo, coordinates and attached documents.
- **FR-010**: The system MUST warn before a move would leave a day-plan activity pointing at a place that belongs to a different visit, and MUST NOT leave such a link in place unresolved.
- **FR-011**: When a visit is removed from the journey, the system MUST NOT silently discard the places, tips or documents filed against it; it MUST either move them somewhere the traveller can still reach or tell the traveller what will be lost before removing it.

**Existing trips**

- **FR-012**: Content already collected on a repeated city before this feature MUST be divided between its visits **by what the day plan already schedules**: a place linked to an activity whose date falls inside a visit MUST be filed against that visit.
- **FR-012a**: A place scheduled inside more than one visit MUST be filed against the earliest such visit, and the traveller MUST be able to find it there. (This does not arise on the Japan trip, where the day plan resolves every scheduled Tokyo place to exactly one stay.)
- **FR-012b**: Anything the day plan cannot place — a place linked to no activity, and every tip and document, which carry no date — MUST be filed against the **first** visit of that city, so that it stays visible somewhere the traveller will look rather than being hidden on a later stay.
- **FR-012c**: The division MUST be reportable: it MUST be possible to say, before and after it runs, exactly which items moved to which visit, so a wrong filing can be found and corrected rather than discovered months later on the trip.
- **FR-013**: The division of existing content MUST NOT delete anything: every place, tip and document that existed before MUST be reachable from some visit afterwards.
- **FR-014**: Each visit MUST carry the city's identity — its name, its local-language name, its summary, its photo, its map position — seeded from the city as it stood before the split, and independently editable afterwards. Two visits of one city therefore read alike on day one and may be told apart later (a different photo for the autumn stay) without either being renamed for the other.
- **FR-014a**: The app MUST know which visits are the same city, so that "move to another visit" (FR-009) is offered only between visits of the same city, and keeps working after one of them is renamed.

**The rest of the app**

- **FR-015**: A day-plan activity MUST resolve to the visit its date falls inside, and MUST link through to that visit.
- **FR-016**: Search results MUST name which visit a matching place belongs to and MUST open that visit.
- **FR-017**: The map MUST offer each visit separately at trip scale and plot only that visit's places at city scale.
- **FR-018**: An exported trip MUST render each visit as its own section in journey order, and MUST NOT repeat one visit's content under another. Whatever a member is not allowed to see stays withheld per visit, exactly as it is withheld per city today.
- **FR-019**: Breadcrumbs and back navigation MUST return the traveller to the visit they came from.
- **FR-020**: Every visibility rule that applies to a city today MUST apply per visit — a member who cannot see stays sees no stays and no stay counts on any visit, and a trip that is not theirs stays invisible.

### Key Entities

- **City**: a destination on a trip — name, local-language name, summary, photo, map position. Shared by all of its visits.
- **Visit**: one stay in a city, with a start and end date and a place in the journey order. The unit that owns content. A city visited once has one visit, which is why single-visit cities are unaffected.
- **Place**: somewhere the traveller has saved — a stay, an attraction, a food spot, a shop. Belongs to a visit rather than to a city.
- **Tip**: a note attached to a visit (or to a single place, unchanged).
- **Document**: a file attached to a visit, to a place, or to the trip as a whole.
- **Day-plan activity**: an entry on a dated day, optionally linked to a place. Already resolves to a visit through its date.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On a trip that visits a city twice, opening either visit shows only that visit's content: 0 places, 0 tips and 0 documents from the other visit appear, and every category count on the page equals the number of items its own list contains.
- **SC-002**: A traveller shown the two Tokyo pages can say which stay each one is within 5 seconds, without opening anything else.
- **SC-003**: Filing a saved place under the correct stay takes at most 3 taps from the place itself, and loses none of what the place holds.
- **SC-004**: 100% of the places, tips and documents that existed on a repeated city before the change are still reachable from one of its visits afterwards.
- **SC-005**: Every trip with no repeated city renders identically to before the change — no new labels, controls or steps appear on any city page.
- **SC-006**: Every surface that lists cities (journey, search, map, export, breadcrumbs, day plan) names the visit for a repeated city; a review of those six surfaces finds no place where two visits are still shown as one.
- **SC-007**: No member gains sight of content their view withholds: for a member who cannot see stays, stays and stay counts are absent from every visit, and the total across visits reveals nothing a single city page would not have.

## Assumptions

- **The split is automatic, not opt-in.** A city with two stops becomes two visits without the traveller asking, because that is the behaviour requested. There is no setting to pool them back together, and none was asked for.
- **Each visit owns its identity** (FR-014), copied from the city at the moment of the split rather than shared afterwards. This is what makes "totally separated" literally true, and it matches a decision the app has already taken once: two *trips* to Tokyo each get their own Tokyo rather than sharing one. Accepted cost: changing Tokyo's photo changes one stay's photo, not both. Rejected alternative — a shared city record behind the visits — would keep one photo but reintroduce exactly the pooling this feature removes, and would touch every surface that reads a place's city.
- **The journey is unchanged.** It already shows a repeated city once per stop, in date order; this feature changes where those stops lead, not how the journey reads.
- **The day plan already works** and is the model being followed: an activity's date already places it in exactly one visit, which is why the day plan is the one surface that never confused the two stays.
- **A place on two stays is two saved places.** The consequence of FR-007 is accepted deliberately: a hotel booked for both Tokyo stays is entered twice and edited twice. The alternative — one place listed under several visits — would make "totally separated" false, and would turn every delete into a question ("here, or everywhere?").
- **The existing division runs once, against the Japan trip.** It is a one-off correction of history, not an ongoing rule: from then on FR-008 (new content lands on the visit you are looking at) is what files things, and the day plan is never consulted again to decide ownership.
- **Scope is one trip.** Two different trips that both visit Tokyo already keep separate content and are untouched here.
- **The shopping list, the flight and the trip's documents stay trip-level.** None of them belongs to a city today, so none of them is divided.
- **Reminders are unaffected** — they are attached to a moment, not a city.
- **The Japan trip is the trip that has this problem**, and its live data is the migration that matters. Any division of existing content has to be right on it the first time; there is no undo, so a division that keeps everything reachable is required (FR-013) even where it is imperfectly filed.
- **The day plan's dates are trustworthy** as a signal of which visit an activity belongs to, since every stop's dates sit inside the trip's dates and stops do not overlap in ordinary use.
