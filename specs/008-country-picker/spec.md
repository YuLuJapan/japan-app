# Feature Specification: Country picker

**Feature Branch**: `claude/country-picker-feature-y85xb7`

**Created**: 2026-08-30

**Status**: Draft

**Input**: Monday board "Onward — Next Four", group `008 · Country picker` — the feature brief and the spec-input update on item "◆ FEATURE — Country picker", plus the foundational item and three user-story items. Feature description: "The destination is free text today: 'Japan', 'japan ', 'Jappan' and 'Tokyo' all save equally well — and three features quietly read that one box (the Essentials gating via isJapanTrip, the currency guess via CURRENCY_BY_COUNTRY, and the analytics country group). Replace the text input with a searchable country list: typing filters it, but only a country from the list can be saved. No cities — stops are still added on the journey exactly as they are today. Deliberately small: one field, one list, one column beside the one already there." Rescoped on the board on 29 Aug: the city picker that was originally part of this spec is out, and is kept as a backlog note.

## User Scenarios & Testing _(mandatory)_

### Foundational Work - One country list, and a code beside the text (Priority: Foundational — blocks every story below)

Nothing below can be built until two things exist. The first is a single list of countries, held in one place and served to the app rather than bundled a second time, so the list a traveller picks from and the list a save is checked against cannot drift apart — the same reason the currency list already works this way. Each entry carries a code, a name, and a flag that is derived from the code rather than shipped as an image.

The second is somewhere to put the answer. The trip already has a free-text country that carries eighty characters of whatever was typed, and roughly a hundred trips' worth of habit around it: the trip's title falls back to it, the Essentials tab reads it, the currency guess reads it. So the code is added **beside** that text, not instead of it. An existing trip keeps rendering exactly as it does today while everything new reads the code.

**Why this priority**: Not a story a traveller can be shown, and every story below is untestable without it. It is also the only part carrying a schema change, which has to reach the live database before any of this works there.

**Independent Test**: Ask the app for the country list and confirm it answers with 243 entries, each with a code, a name and a flag, and that a country the currency map already knows (Japan, Portugal, Czechia) is present exactly once. Save a trip with a country code and confirm both the code and its name are stored; read back a trip written before this existed and confirm its text is unchanged and its code is empty.

**Acceptance Scenarios**:

1. **Given** a signed-in traveller, **When** the app asks for the country list, **Then** it receives every country it may offer, each with its code, its English name and its flag, from the same source that validates a save.
2. **Given** a trip saved with a country chosen from the list, **When** the trip is read back, **Then** it carries both the chosen country's code and a name matching the list entry.
3. **Given** a trip whose country was typed before this feature existed, **When** it is read back, **Then** its country text is exactly what was typed and it carries no code — nothing has been guessed on its behalf.

---

### User Story 1 - Pick my country from a list instead of typing it (Priority: P1)

Someone starting a trip opens the trip sheet, starts typing where they are going, and chooses their country from a short filtered list showing its flag and its name. They cannot misspell the one field that three other parts of the app read, because what they type filters the list and never becomes the value.

**Why this priority**: This is the request. It ships alone and the trip sheet is better the day it lands, with or without the two stories below.

**Independent Test**: Open the trip sheet, type "jap", confirm Japan is offered with its flag, select it, save, and confirm the trip carries the country. Then type "Jappan", confirm nothing matches, and confirm that saving refuses it with a message beside the field rather than storing it or silently emptying it. Confirm a trip can still be saved with no country at all.

**Acceptance Scenarios**:

1. **Given** the trip sheet is open, **When** the traveller types part of a country's name, **Then** the list narrows to the countries that match, each shown with its flag and name, and what they typed is not itself a saveable value.
2. **Given** a filtered list, **When** the traveller selects a country, **Then** the field shows that country's flag and name, and saving stores it.
3. **Given** the traveller has typed something no country matches, **When** they try to save, **Then** the trip is not saved, the field carries a message saying the country must be chosen from the list, and what they typed is still on screen to correct.
4. **Given** the trip sheet is open, **When** the traveller leaves the country empty, **Then** the trip saves — the country is optional and stays optional.
5. **Given** a country is already chosen, **When** the traveller clears the field and saves, **Then** the trip has no country at all, with nothing left behind from the previous answer.
6. **Given** a traveller using the keyboard or a screen reader, **When** they reach the field, **Then** they can open the list, move through the matches, hear each one announced, choose one and dismiss the list without a pointer, and the number of matches is announced as it changes.

---

### User Story 2 - Have the currency and the Japan advice follow the country I picked (Priority: P2)

What the app already infers from the country stops depending on how it was spelled. Picking Japan prefills yen and brings the Japan-only Essentials cards; picking Portugal prefills euros and brings none of them.

**Why this priority**: The payoff for doing this at all — but the picker is worth having before it, because the inference is already right for anyone who spells the country correctly.

**Independent Test**: Pick Japan and confirm JPY is prefilled and that Visit Japan Web, Suica, Takkyubin, 110/119 and the romaji phrasebook are present. Pick Portugal and confirm EUR is prefilled and that none of those appear. Pick a country the currency map does not know and confirm the currency already on the trip is left alone rather than blanked. Pick a country after choosing a currency by hand and confirm the hand-chosen currency stands.

**Acceptance Scenarios**:

1. **Given** the traveller has not chosen a currency themselves, **When** they pick a country the app can price, **Then** that country's currency is prefilled.
2. **Given** the traveller has already chosen a currency themselves, **When** they pick a country, **Then** their currency is left exactly as they set it.
3. **Given** a country the currency guess does not cover, **When** it is picked, **Then** the currency on the trip is unchanged — not emptied and not reset to a default.
4. **Given** a trip whose country is Japan by code, **When** Essentials is opened, **Then** the Japan-only content appears, in the same words as today.
5. **Given** a trip whose country is any other country, or no country at all, **When** Essentials is opened, **Then** no Japan-only content appears anywhere on it.

---

### User Story 3 - Open a trip I created before the picker existed (Priority: P3)

Someone with a trip already saved opens it, edits the dates, and saves. Nothing about their country changes, whether or not the list can recognise what they once typed.

**Why this priority**: The safety story. It is P3 because it is invisible when it works, and it is the reason the picker can ship at all: the alternative — rewriting old rows to a guess — is the one outcome nobody could undo.

**Independent Test**: Open a trip whose country is free text and confirm the sheet shows it matched to a list entry where the name matches exactly, and shows it unchanged where it does not. Save without touching the country and confirm neither the text nor the code moved. Save a change that omits the country entirely and confirm the same. Confirm the trip's title still falls back to the country as it does today.

**Acceptance Scenarios**:

1. **Given** a trip whose country text names a country on the list, **When** the trip sheet opens, **Then** that country is shown as selected, and saving without touching it changes nothing stored.
2. **Given** a trip whose country text matches nothing on the list, **When** the trip sheet opens, **Then** the text is shown as it was typed, and **When** they save, **Then** the save is refused with a message beside the country field, which they resolve by choosing a country or by emptying the field — empty being a legitimate answer.
3. **Given** any trip, **When** a change is saved that does not mention the country, **Then** both the country text and its code are left exactly as they were.
4. **Given** a trip with country text and no code, **When** anything reads the country — the title, the currency guess, the Essentials gating — **Then** it still answers from the text, exactly as it does today.

---

### Edge Cases

- **Typing an exact country name and never opening the list.** Someone types "Japan" in full and moves on, expecting it to have worked. The field treats a complete, case-insensitive match against a single list entry as that country, and shows the flag and name to confirm it. A partial match, or one matching several entries, is not resolved on the traveller's behalf.
- **Typing something that matches nothing.** "Jappan" narrows the list to empty. The field must neither save the raw text nor quietly clear itself — it says the country has to be chosen from the list, and leaves what was typed on screen. A stored country that matches nothing is the same case and gets the same message: three live trips hold one ('Amsterdam', 'IL', 'Japan & Seoul'), and the traveller resolves it by choosing a country or emptying the field.
- **A trip with no country at all.** The field is optional and stays optional. Everything derived from the country has a defined answer for "none", and it is the generic one — no Japan content, no currency change, no invented default.
- **A saved change that omits the country.** Leaves both the text and the code untouched. Clearing requires an explicit instruction to clear.
- **Clearing a country that was already set.** Both the text and the code clear together. A trip must never end up with a code and no name, or a name and no code.
- **The list has not arrived yet.** A cold start or no signal must not leave the field empty and unusable; the list is small enough to be held on the device, and a country already on the trip is shown whether or not the list has loaded.
- **A currency the traveller already chose.** Picking a country from a list is a stronger signal than typing one, but it is still not licence to overwrite a currency the traveller set by hand.
- **Countries the currency guess does not know.** It covers 76 keys; the list has 243 entries. Picking one of the remaining ~167 leaves the currency alone rather than blanking it.
- **Names that disagree with what someone typed.** "UK" against "United Kingdom", "Czechia" against "Czech Republic". The list's own name wins for a newly picked country; old text is never rewritten to match it.
- **Two people editing the same trip.** Last save wins, as everywhere else. Nothing here introduces a merge.

## Requirements _(mandatory)_

### Functional Requirements

#### The country list (foundational)

- **FR-001**: The system MUST hold one list of countries, each entry carrying an ISO-3166 alpha-2 code, an English name and a flag, and MUST serve that same list to the app rather than the app carrying a second copy.
- **FR-002**: The flag MUST be derived from the country's code rather than stored as an image asset, so adding a country costs nothing but a row.
- **FR-003**: The list MUST be reference data available to any signed-in traveller, independent of any particular trip — it is not trip content and MUST NOT be reachable only through a trip.
- **FR-004**: The list MUST cover every country the currency guess already knows, including the names it knows as aliases, so that no country that could be priced before this feature stops being pickable after it.
- **FR-005**: A trip MUST be able to carry a country code alongside its existing country text. The text MUST keep its meaning and its existing 80-character limit, and no existing trip's text may be rewritten by this feature.

#### Picking a country

- **FR-006**: The trip form MUST offer the country as a filter-as-you-type list rather than a plain text box or an unfiltered list of 243 rows, showing each candidate's flag and name.
- **FR-007**: Typing MUST filter the list and MUST NOT itself become the saved value.
- **FR-008**: The system MUST NOT save a country that is not on the list. This MUST be enforced where the trip is saved, not only in the form — the form is a convenience, never the guard.
- **FR-009**: When what was typed matches no country, the system MUST refuse the save and say so beside the field, and MUST NOT clear the field, substitute a nearest match, or save the raw text.
- **FR-010**: The system MUST NOT fuzzy-match a typed country to a list entry. A complete, case-insensitive, unambiguous match to one entry MAY resolve to that country; anything less MUST NOT.
- **FR-011**: The country MUST remain optional. A trip with no country MUST save, and every consumer of the country MUST have a defined behaviour for none. **Empty and unrecognised are different answers**: absent is always allowed, present-and-not-a-country never is, and emptying the field is therefore always a way past the error.
- **FR-012**: Setting a country MUST store its code and its name together; clearing one MUST clear both.
- **FR-013**: A save that does not mention the country MUST leave both the country and its code untouched.
- **FR-014**: The field MUST be operable by keyboard alone and MUST be announced to a screen reader: the list's open state, the number of matches as it changes, and the currently highlighted candidate.
- **FR-015**: The field MUST be usable before or without the list arriving from the network — it MUST NOT sit empty waiting on a fetch, and MUST still show the country the trip already has. With no list, nothing may be judged unrecognised and **no country may be written**: a save must leave both columns untouched rather than clear them.

#### What follows from the country

- **FR-016**: Where a trip carries a country code, the currency guess and the destination-specific content MUST be decided from that code rather than from the text.
- **FR-017**: A prefilled currency MUST NOT overwrite a currency the traveller chose themselves.
- **FR-018**: Picking a country the currency guess does not cover MUST leave the trip's currency unchanged rather than emptying or defaulting it.
- **FR-019**: Destination-specific content MUST appear only for the country it belongs to. A trip with no country, or a country the system does not recognise, MUST get the generic content.
- **FR-020**: This feature MUST NOT add an analytics property. The country already carries the grouping, and no city, address or free text may ride along on any event.

#### Trips that predate the picker

- **FR-021**: The system MUST NOT backfill a code onto an existing trip by guessing from its text. A code is recorded only when a traveller picks one.
- **FR-022**: Where a trip has country text and no code, every consumer MUST keep answering from the text, with the same matching behaviour it has today.
- **FR-023**: Opening a trip whose text names a country on the list MUST show that country as selected without storing anything until the traveller saves.
- **FR-024**: Opening a trip whose text matches nothing MUST show the text as typed, without discarding it or rewriting it. Saving that trip MUST be refused with the same message any other unrecognised country gets, offering the two ways out: choose a country, or empty the field.
- **FR-024a**: An unrecognised country MUST NOT be passed through silently on a save of unrelated fields. It decides the currency guess and the destination-specific content, so carrying it forward unremarked would preserve a wrong answer indefinitely — the point at which someone is editing the trip is the point at which they can fix it.
- **FR-025**: The trip title's existing fallback chain MUST be unchanged, including its fallback to the country text.

### Key Entities

- **Country**: A pickable destination. Carries an ISO-3166 alpha-2 code (the identity), an English name (what is shown and what is stored beside the code), and a flag derived from the code. The list is static reference data — it is not trip content, it is not editable in the app, and it belongs to no trip.
- **Trip**: Gains a country code beside its existing free-text country. Both are optional, both clear together, and a trip may legitimately hold text with no code — that is every trip that existed before this feature.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A misspelled or invented country cannot be saved on a trip. Attempting it leaves the trip unsaved and tells the traveller why, in every route into the trip form.
- **SC-002**: A traveller can set the country in under 10 seconds from opening the form, typing no more than three characters before their country is visible in the list.
- **SC-003**: 100% of trips created after this ships that name a country carry a code for it; 0% of trips created before it have had one written on their behalf.
- **SC-004**: Every country the app could price before this feature can still be picked after it — no country loses its currency guess.
- **SC-005**: Opening and saving a trip created before this feature changes nothing about its country, including when the save does not mention the country at all.
- **SC-006**: Destination-specific advice is correct for 100% of trips whose country was picked from the list, with no false positives from spelling and no false negatives from a variant.

## Assumptions

- The country list is static data that ships with the app rather than being fetched from any third party — no geocoding service, no API key, and nothing that could cost money or fail at runtime.
- Roughly 200 entries is small enough to send in one response and hold on the device; no paging or server-side search is needed.
- Flags rendered from the code display as flags on the phones this app is used on. On some desktop platforms they render as a letter pair; that is a known and accepted gap for a mobile-first app, not a defect to design around.
- The trip form is the only place a country is set. Nothing else in the app writes one.
- English names are sufficient — the app is not localised, and the list is not translated.
- A trip has exactly one country. A trip that visits two is out of scope here, as it is today.

## Out of Scope

- **Cities and zones.** Nothing in this spec creates, edits or suggests a zone. Stops are added on the journey exactly as they are today. Offering a country's cities at the same time was considered and rejected: a zone is only reachable through a dated journey step, so it would mean either inventing a split of the trip's dates or introducing unscheduled zones — a change to the journey model — and a city list would need a curated shortlist per country plus a fallback to a lookup service capped at one request per second. Neither is needed to stop someone typing "Jappan". Kept as a backlog note on the board.
- **Per-country content beyond what exists.** Making Essentials worth reading outside Japan is spec 010, which depends on this one for a code to key on.
- **Backfilling old trips.** Deliberate, and stated as a requirement rather than an omission.
- **Multi-country trips**, translated country names, and any change to the trip title.
