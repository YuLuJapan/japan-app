# Feature Specification: Explore, connected to the plan

**Feature Branch**: `claude/explore-tags-connection-zmqxuz`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "As of now the explore section under each city is not connected to the tags in the activities. We need to make that connection." Two questions were settled with the user before writing: the connection runs **both ways** (Explore reflects the plan, and an activity's tag navigates into Explore), and an activity that carries a tag but links to nothing saved is **listed separately** rather than merged in with the saved places.

## Context

A city page has two halves that never meet.

**Schedule** shows the days spent in this city and the activities planned on them. Each activity can carry a coloured tag — one the traveller typed on the activity form, or one derived from the saved place it links to.

**Explore** shows a grid of category cards — Stays, Things to do, Food & cafés, Shopping — each counting the places _saved_ under it in this city, each opening a list of those places.

So the two halves of the same category say different things and neither knows about the other:

- "Whatever the konbini has" is tagged Food, is on Thursday, and is invisible from Explore. Food says "3 saved" and lists three restaurants nobody has scheduled.
- A ramen shop that is already booked for Thursday looks exactly like one saved months ago and never picked. Deciding what to do tonight means reading the whole plan and the whole Explore list and matching them up by name.
- The tag on an activity is a coloured pill and nothing else. It names a category, and tapping it does nothing.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Explore says what is planned, not just what is saved (Priority: P1)

A traveller opens Tokyo and looks at the Explore grid. Each category card now says both numbers — "6 saved · 2 planned" — so before opening anything they know Food has six ideas of which two are on the plan, and that Shopping has nothing saved but one thing planned. A category with something planned and nothing saved appears on the grid; a category with neither is still absent.

**Why this priority**: It is the smallest change that makes the two halves of the page agree, it is visible without opening anything, and every story below reads better once the grid is honest. It ships alone.

**Independent Test**: On a city with a plan, confirm each category card's planned number equals the activities of that category in that city, that a category with only planned activities is on the grid, and that a category with neither is not.

**Acceptance Scenarios**:

1. **Given** a city with four saved food spots and two activities tagged Food on days spent there, **When** the traveller opens the city, **Then** the Food card reads "4 saved · 2 planned".
2. **Given** a city with no saved shops and one activity tagged Shopping, **When** the traveller opens the city, **Then** a Shopping card appears reading "0 saved · 1 planned" and opens a list.
3. **Given** a city with nothing saved and nothing planned under Things to do, **When** the traveller opens the city, **Then** no Things-to-do card is drawn.
4. **Given** a category with saved places and nothing planned, **When** the traveller opens the city, **Then** the card reads as it does today ("4 saved") and says nothing about the plan.

---

### User Story 2 - A category list shows the plan beside the saved places (Priority: P2)

Opening Food in Tokyo shows what is planned first — each activity with the day and the time it sits at — and then the saved food spots, each marked when it is already on the plan. The two are separate bands with their own headings, never one merged list: a place saved is an idea, an activity is a commitment, and the traveller has to be able to tell them apart at a glance. Tapping a planned activity that links to a saved place opens that place; tapping one that links to nothing opens the day it is planned on.

**Why this priority**: It is where the decision is actually made — "we already have a day for this" — and it needs Story 1's counting rule to exist first.

**Independent Test**: Open a category list in a city that has both saved places and planned activities of that category, and confirm two labelled bands, the day and time on every planned row, the marker on each saved place that is on the plan, and no marker on the ones that are not.

**Acceptance Scenarios**:

1. **Given** a category with planned activities and saved places, **When** the traveller opens the category list, **Then** the planned activities appear under their own heading above the saved places, which keep theirs.
2. **Given** an activity tagged Food on Thu 19:00 with no saved place behind it, **When** the traveller opens Food, **Then** it appears in the planned band with its day and time, and it is not counted or drawn as a saved place.
3. **Given** a saved place that an activity links to, **When** the traveller opens its category, **Then** the saved row carries a marker naming when it is planned.
4. **Given** a saved place nothing links to, **When** the traveller opens its category, **Then** its row is unchanged from today.
5. **Given** a category whose only content is planned, **When** the traveller opens it, **Then** the planned band is shown and the saved band says nothing is saved yet, rather than the page reading as empty.
6. **Given** a planned activity that links to a saved place, **When** the traveller taps it, **Then** that place opens; **and given** one that links to nothing, **When** they tap it, **Then** the day it is planned on opens.

---

### User Story 3 - The tag on an activity is a way in (Priority: P3)

Reading the plan, a traveller taps the Food pill on Thursday's dinner and lands in that city's Food list — the other things saved and planned nearby, in one tap, instead of navigating back to the city and down into Explore.

**Why this priority**: It is the return direction of the same connection and the cheapest of the three, but it is worth little until the list it opens has something more than today's saved places in it.

**Independent Test**: From the day plan, tap an activity's tag and confirm it opens the matching category list for the city that activity belongs to; confirm an activity carrying no tag offers nothing to tap.

**Acceptance Scenarios**:

1. **Given** an activity tagged Food in Tokyo, **When** the traveller taps the tag, **Then** Tokyo's Food list opens.
2. **Given** an activity with no tag, **When** the traveller reads it, **Then** there is no pill and nothing to tap, exactly as today.
3. **Given** an activity tagged on a day two cities share, **When** the traveller taps the tag, **Then** the list that opens is the one for the city that activity is planned in — not the other city the day touches.
4. **Given** an activity whose city cannot be told (it belongs to no city and the day touches more than one), **When** the traveller reads it, **Then** the tag is shown but is not a link, rather than guessing a city.

---

### Edge Cases

- **A member who cannot see stays.** Nothing here widens what anyone is shown. They see no Stays card, no stay count and no planned stay — an activity that only reads as a stay because of the place behind it must not reappear as a planned Stays row, and the Stays card must not come back because something is planned under it.
- **A withheld place link.** A planned activity whose link was cut for this member keeps its own typed tag if it has one and is listed as planned with no place behind it — it must not name, link to, or otherwise re-announce the place it was pointing at.
- **A day two cities share.** An activity belongs to the city it is planned in, and Explore counts it there and nowhere else. Both cities' pages must agree with their own schedules: what a city's schedule shows for a day is what its Explore counts for that day.
- **An activity belonging to no city** (written before every activity carried one) counts on every city page whose days it falls in — the same rule the schedule on that page already applies, so the two halves cannot disagree.
- **An activity outside the trip's dates or on a day this city is not visited** is not counted here: Explore counts what the city's own schedule shows.
- **The "More" category** takes no tag, so its card is unchanged: saved only, no planned count, no planned band.
- **An activity linked to a place in another city.** It is planned where the activity is planned. The saved place is marked in _its own_ city's list, since that is where its row lives.
- **Several activities on one saved place** (lunch there Tuesday, again Friday). The saved row is marked with the first, and says there is more than one.
- **Nothing planned at all.** Every card and every list reads exactly as it does today — no empty "0 planned", no empty band.
- **The plan has not arrived yet** on a slow connection. Cards show what they can (the saved counts) and add the planned half when it lands; they never flash a wrong number or block the grid.

## Requirements _(mandatory)_

### Functional Requirements

**Counting and the grid**

- **FR-001**: A city's Explore card for a category MUST report both how many places are saved under it in that city and how many activities in that city carry that category tag.
- **FR-002**: An activity counts under a category when it carries that tag — whether the traveller typed it on the activity or it came from the place the activity links to — with the typed one taking precedence, exactly as the day plan already resolves it.
- **FR-003**: An activity counts in a city when that city's own schedule shows it. The city page's Explore and its Schedule MUST use one rule, so they can never disagree.
- **FR-004**: A category card MUST appear when it has saved places or planned activities, and MUST NOT appear when it has neither.
- **FR-005**: The planned half of a card MUST be silent when nothing is planned — a category with saved places only reads as it does today.
- **FR-006**: Only the four taggable categories (Stays, Things to do, Food & cafés, Shopping) can carry a planned count. "More" is unchanged.

**The category list**

- **FR-007**: A category's list MUST show the planned activities of that category in that city in a band of their own, above the saved places, each under a heading naming what it is.
- **FR-008**: A planned row MUST name the activity, the day it is on and the time it starts (or that it is at no particular time).
- **FR-009**: Planned rows MUST be ordered as the plan is: by day, then by their order within the day.
- **FR-010**: A planned row that links to a saved place MUST open that place. One that links to nothing MUST open the day it is planned on.
- **FR-011**: A saved place that at least one activity in this city links to MUST be marked with when it is planned; where more than one activity links to it, the marker names the first and says there are others.
- **FR-012**: A saved place nothing links to MUST be unchanged.
- **FR-013**: A category list with planned activities and no saved places MUST still show the planned band, and MUST say the saved half is empty rather than reading as an empty page.
- **FR-014**: The planned band MUST NOT be merged into the saved list, and a planned activity MUST NOT be presented as, or counted as, a saved place.

**Navigating from a tag**

- **FR-015**: An activity's category tag on the day plan MUST open that category's list for the city the activity is planned in.
- **FR-016**: A tag whose city cannot be determined MUST remain a plain tag rather than opening a guessed city.
- **FR-017**: An activity with no tag MUST be unchanged — nothing added, nothing tappable.

**What must not change**

- **FR-018**: This feature MUST NOT widen what any member is shown. A member whose view withholds stays sees no Stays card, no stay count, no planned stay and no stay marker; a planned activity whose place link was withheld must not reveal the place through a count, a name, a marker or a link.
- **FR-019**: Nothing here changes what is stored. No new kind of tag, no new field on an activity, and no change to how an activity is created or edited.
- **FR-020**: The city page MUST answer this from what it already loads. No new request is made to build the counts or the bands.
- **FR-021**: Analytics for these surfaces MUST carry shapes only — a category, a count, whether a row was planned or saved — and never an activity's title, a place's name or a day's content.
- **FR-022**: The exported trip is unaffected: a planned count is a reading of the plan, not a field, and nothing new travels into an export.

### Key Entities

- **Saved place**: an idea recorded in a city under one category. Already counted and listed by Explore today.
- **Planned activity**: an entry on a day of the plan, belonging to a city, optionally carrying a category tag and optionally linking to a saved place. Already drawn by the schedule and the day plan today.
- **Category**: the four taggable ones plus "More". Its colour, icon and label already come from one shared table that every surface reads.
- **City visit**: the days a city is stayed in, which is what decides which activities Explore counts. Already computed for the city page's schedule.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: From a city page, a traveller can tell how much of a category is already on the plan without opening anything and without reading the schedule.
- **SC-002**: Deciding "have we already got a day for this?" for a saved place takes one tap (open its category) rather than cross-reading the schedule — measured as: every saved place that is on the plan is marked in its category list.
- **SC-003**: Every activity carrying a tag is reachable from its city's Explore, including the ones that link to nothing saved: for any city, the number of planned rows across the four category lists equals the number of tagged activities the city's schedule shows.
- **SC-004**: From an activity on the plan, the matching category list is one tap away.
- **SC-005**: A member whose view withholds stays sees exactly what they see today on both the grid and every category list — no count, row, marker or card changes for them.
- **SC-006**: A city with nothing planned renders exactly as it does today, on the grid and in every category list.
- **SC-007**: Opening a city page makes no more requests than it does today.

## Assumptions

- "Planned" means an activity on the plan of a day spent in this city, resolved by the same rule the city's schedule already uses — including an activity that belongs to no city, which that rule shows on every city page whose days it falls in.
- A planned count counts activities, not distinct places: two dinners at the same ramen shop are two planned things, and the shop is one saved thing.
- An activity linked to a saved place is counted as planned _and_ the place stays counted as saved. The two numbers answer different questions and are shown apart, so nothing is double-counted within one number.
- The card's second number is omitted rather than shown as zero, so a trip with no plan yet is untouched.
- The grid keeps its current order (the fixed category order), rather than being re-sorted by what is planned — a card that moved between visits would be harder to find, not easier.
- Where a category list's planned band and its saved band both have content, planned comes first: it is dated, it is fewer rows, and it is the half the traveller came for.
- No new endpoint and no schema change: the city page already loads its zone detail and the trip's whole plan, which together answer every requirement here.
- The feature is not put behind a flag. It changes two existing screens rather than adding a surface, it has no rollout risk of its own, and both flags in the app exist to gate a new screen.
