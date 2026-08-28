# Feature Specification: Export the Trip

**Feature Branch**: `claude/speckit-export-feature-003-ypz8xf`

**Created**: 2026-08-28

**Status**: Draft

**Input**: Monday board "Onward — Next Four", group `003 · Export` — feature brief and spec-input updates on item "◆ FEATURE — Export the trip", plus the cross-cutting constraints item. Feature description: "Deterministic export (no model anywhere) of a trip into a shareable file. One projection with a detail parameter builds two versions: Share (journey steps, zones, dates; per place name, address, category only) and Full (everything including descriptions, links, tips, day-by-day plan). PDF first; DOCX, XLSX and JSON follow. Client-side generation so it works offline. Composes with the caller's TripView. Two labelled actions, never one toggle. Any member may export, viewers included."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Share my trip with a friend, with nothing personal in it (Priority: P1)

As someone whose friend is going where I went, I want to send them my route and the places worth visiting, so they benefit from my research without ever seeing my booking details. I pick "Share with a friend", and I get one file: the journey — each stop, its city, its dates — and under each stop the places I saved, each one just a name, an address and what kind of place it is. Nothing I typed about a place travels with it.

**Why this priority**: This is the whole point of the feature and the reason it goes first. It is also the only version with a privacy risk to design away, so it is the version that defines the shape of everything else. It ships alone as the MVP.

**Independent Test**: Export a trip as a share file and confirm it contains the journey steps, zones, dates, and each place's name, address and category — and contains no description, no summary line, no links, no tips, no day plan, no documents, no flight details, no shopping list and no member names.

**Acceptance Scenarios**:

1. **Given** a trip with several journey steps and saved places, **When** the traveller chooses "Share with a friend", **Then** a file is produced listing every step in journey order with its zone and dates, and under each the places saved in that zone.
2. **Given** a place whose description contains a hotel confirmation number, **When** the share file is produced, **Then** that place appears with only its name, address and category, and the confirmation number appears nowhere in the file.
3. **Given** a trip with hotels, attractions, food, shopping and other places, **When** the share file is produced, **Then** every category is present — hotels are included whole, because nothing that makes a hotel sensitive survives the share projection.
4. **Given** the traveller has the trip open with no network connection, **When** they choose "Share with a friend", **Then** the file is still produced from what is already on the device.
5. **Given** a produced file, **When** the traveller confirms the export, **Then** they can hand it on directly through their device's sharing, or save it, and the file's name identifies the trip.

---

### User Story 2 - Keep a full copy of my own trip (Priority: P2)

As a traveller, I want a readable copy of everything in my trip — the descriptions I wrote, the links I collected, the tips, and the day-by-day plan — so I can print it, keep it in a folder outside the app, or read it somewhere the app is not.

**Why this priority**: It is the same projection at a different depth, so it costs little once Story 1 exists; and it is what makes the feature useful to the person who built the trip rather than only to the person receiving it. It is useless on its own only in the sense that it would still need Story 1's structure.

**Independent Test**: Export the full version and confirm descriptions, links, tips and the day plan are all present, and that a member with a restricted view exports only what that view already shows them.

**Acceptance Scenarios**:

1. **Given** a trip with descriptions, links, tips and a populated day plan, **When** the traveller chooses "Full copy", **Then** all of it appears in the file, organised by journey step and zone.
2. **Given** the export screen, **When** the traveller looks at it, **Then** "Share with a friend" and "Full copy" are two separately labelled actions, and there is no single control that switches one into the other.
3. **Given** a viewer who is not allowed to see stays, **When** they export either version, **Then** the file contains no hotels and no hint that hotels exist.
4. **Given** an owner with the unrestricted view, **When** they export the full version, **Then** the file still contains no flight details, no shopping list, no documents and no member names — those are out of every export, not merely out of a restricted one.
5. **Given** any member of the trip — owner, partner or viewer — **When** they open the trip, **Then** both export actions are available to them.

---

### User Story 3 - Choose the file format (Priority: P3)

As someone sharing a plan, I want it as a word-processor or spreadsheet file, so the person receiving it can edit it, extend it, or paste it into their own planning.

**Why this priority**: Purely additive — the same content, written out differently. It broadens who the file is useful to, but nobody is blocked without it.

**Independent Test**: Export the same trip in each offered format and confirm each contains the same content as the printable version, at the same detail level.

**Acceptance Scenarios**:

1. **Given** a trip, **When** the traveller exports it in the word-processor format at share detail, **Then** it contains exactly the same content as the printable share file.
2. **Given** a trip, **When** the traveller exports it as a spreadsheet, **Then** the places are laid out as rows that can be sorted and filtered, at the chosen detail level.
3. **Given** any offered format, **When** the traveller chooses a detail level, **Then** the same share/full rule applies unchanged — a format never widens what is included.

---

### User Story 4 - Keep a machine-readable backup (Priority: P3)

As the owner, I want a structured data file of the whole trip, so a copy of everything survives losing the account or the hosting project it lives in.

**Why this priority**: Insurance, not daily use. The trip currently exists in exactly one place and nowhere else, which is why it is on the list at all; it ranks below the versions a person actually reads.

**Independent Test**: Download the structured file and confirm every field and identifier of the trip is present and unchanged, so the content could be reconstructed from it.

**Acceptance Scenarios**:

1. **Given** a trip, **When** the owner exports the structured version, **Then** it contains the trip, its zones, journey steps, places, tips and day plan with their identifiers intact.
2. **Given** the structured export, **When** it is produced at share detail, **Then** it carries exactly the same reduced fields as the printable share file — the machine-readable form is not a way around the projection.

---

### Edge Cases

- **A place with no address**: name and address are the entire share payload, so a place without an address would otherwise be an empty row. The place MUST still be listed by name, and the export MUST report how many of its places have no address, so the gap is visible rather than silent.
- **New fields appearing on a place later**: a field added to places in future must never join the share export by default. The set of exported fields is chosen explicitly, one by one, and there MUST be a test that fails when a new place field appears without a decision being made about it. This is the whole safety story for the share version.
- **An empty or half-planned trip**: a trip with no places, no steps, or no day plan MUST export a skeleton with honest empty sections rather than refusing to export.
- **A long trip**: a trip roughly three times the size of a real one (~120 places) MUST still produce a usable readable file, with page numbers and a contents listing keyed to journey steps.
- **Non-Latin characters in names and addresses**: the localised-name field is deliberately out of scope for this phase, and no current place name or address contains non-Latin characters. If such text were pasted into a name or address, the readable file must not render it as blank boxes — this is a known limitation recorded with the deferred localised-name work, not a silent failure this phase creates.
- **No network**: the export MUST work from what the device already holds, with no request required to produce the file.
- **A restricted view that empties a section**: when a member's view removes an entire category (for example, all stays), the section is absent rather than present-and-empty, and the export never states what was withheld.
- **Two exports of the same trip at the same detail**: the same trip and the same detail level MUST always produce the same content — nothing in the export is generated, inferred, summarised or reworded.

## Requirements *(mandatory)*

### Functional Requirements

**The two versions**

- **FR-001**: The system MUST offer exactly two detail levels — *share* and *full* — built from a single projection of the trip, so the two can never drift apart.
- **FR-002**: The share version MUST contain: the trip's title and dates, its journey steps in order with each step's zone and dates, and for each place its name, its address and its category.
- **FR-003**: The share version MUST exclude place descriptions, the derived summary line (it is the opening of the description and carries whatever the description carries), links, tips, the day plan, documents, flight details, the shopping list and the trip's members.
- **FR-004**: The full version MUST additionally contain place descriptions, links, tips (both zone-level and place-level) and the day-by-day plan — and nothing beyond that.
- **FR-004a**: Neither version MUST contain the trip's flight details, its shopping list, its documents or its member names. "Full" is full about *places and the plan*; the trip-level private material never enters an exportable file at all, so a full copy forwarded to the wrong person still leaks no booking reference and no present. A traveller who wants those has the app.
- **FR-005**: The share and full versions MUST be offered as two separately labelled actions. The system MUST NOT offer a single export control with a detail toggle — a toggle left unflipped is how a confirmation number reaches a group chat.
- **FR-006**: The export MUST be deterministic: no language model, no summarisation, no rewording, no inference anywhere in producing it.

**Who may export, and what they get**

- **FR-007**: Any member of a trip MUST be able to export it, viewers included — the file is strictly a subset of what that member already sees on screen.
- **FR-008**: The export MUST compose with the exporting member's own content permissions, applied before the share/full projection, so the file can never be a way to read something the app withholds. Given FR-004a the flag that bites today is stays — a member who cannot see stays exports no stays, and no trace that stays exist. The rule is stated generally on purpose: anything later admitted to the export inherits it.
- **FR-009**: A member of one trip MUST NOT be able to export another trip, and an attempt to do so MUST be indistinguishable from that trip not existing.

**Fields and drift**

- **FR-010**: The fields carried into each version MUST be chosen explicitly and individually. The system MUST NOT build a version by taking a whole record and removing fields from it.
- **FR-011**: The system MUST have a test that fails when a new field is added to a place without an explicit decision about whether it is exported.

**Formats**

- **FR-012**: The system MUST produce a printable, page-based document as the first format, with page numbers and a contents listing keyed to journey steps.
- **FR-013**: The system MUST subsequently offer a word-processor format, a spreadsheet format and a structured data format, each carrying the same content at the chosen detail level.
- **FR-014**: The choice of format MUST NOT change what is included — detail level alone decides that.
- **FR-015**: The exported file MUST be named after the trip and its detail level, following the same file-naming rules the app already uses for downloads.

**Behaviour**

- **FR-016**: The export MUST be produced on the traveller's own device, so it works with no network connection from the trip already loaded.
- **FR-017**: On a device that supports handing a file to another app, the system MUST offer to share the file directly; where it does not, the system MUST fall back to a download.
- **FR-018**: The system MUST report how many places in the export have no address.
- **FR-019**: The system MUST record that an export happened, capturing only the shape of it — format, detail level, number of places, number of days, and whether stays were included — and never any trip content.
- **FR-020**: An export that fails MUST say so plainly to the traveller rather than producing a partial or empty file.

### Key Entities

- **Trip export**: one produced file. Identified by its trip, its detail level and its format. Carries no state — it is not stored, listed or re-openable; it exists only once handed to the traveller.
- **Export projection**: the single description of what each detail level contains, per entity and per field. The one place a field is admitted to an export.
- **Detail level**: *share* or *full*. Determines fields only, never which format is available and never who may export.
- **Exported trip content**: the trip (title, dates, country), its zones, its journey steps, its places, its tips and its day plan — each reduced by the projection at the chosen level.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of share exports contain no place description, link, tip, day-plan entry, document, flight detail, shopping item or member name — verified field by field against a trip in which every one of those is populated.
- **SC-002**: A traveller can go from an open trip to a shareable file in under 15 seconds and at most two taps, without reading any explanation of which version to pick.
- **SC-003**: A trip of roughly 120 places across a dozen stops produces a readable file in under 10 seconds on a mid-range phone, with every stop reachable from the contents listing.
- **SC-004**: Exporting with no network connection succeeds for a trip the traveller has already opened, in 100% of attempts.
- **SC-005**: For a member with a restricted view, the exported file is a strict subset of what that member can see in the app — 0 items in the file that they cannot reach on screen.
- **SC-006a**: 100% of full exports contain no flight detail, no shopping item and no member name — verified against a trip in which all three are populated, by an owner with the unrestricted view.
- **SC-006**: Exporting the same trip twice at the same detail level and format produces identical content, every time.
- **SC-007**: Adding a new field to a place without a decision about exporting it causes an automated check to fail before the change can ship — 0 fields can join the share export unnoticed.
- **SC-008**: Every place in a share export is identifiable to the recipient: it shows a name, and where the address is missing the export says how many such places there are rather than showing blank rows.

## Assumptions

- **Deferred, and recorded as such**: the localised-name field is out of scope for this phase. That is what removes non-Latin text from the readable file entirely — no current place name or address contains any — and it is tracked as backlog work to return together with the font handling it needs.
- **Nothing is stored**: exports are produced and handed over. There is no export history, no shareable link, no server-held copy, and no expiry to manage.
- **No new data**: the export reads the trip content that already exists. No new tables, no new stored fields, and therefore no database migration.
- **No new spend**: producing the file adds no infrastructure and no paid service, in keeping with the project's $0 target and $5 ceiling.
- **Mobile-first**: the primary device is a phone, and the primary act is handing the file to someone through the phone's own share mechanism. Printing is a secondary use of the same file.
- **Existing permissions are reused unchanged**: the export inherits the trip's existing membership check and the existing per-member content flags, rather than introducing an export-specific permission.
- **"Full" is bounded deliberately**: it means every field of the places, tips and day plan, not every row attached to the trip. The flight, the shopping list, the documents and the member list are out of both versions by decision, not by oversight — the export is a document about where you went, and the material with real blast radius is kept out of files entirely rather than guarded by a label.
- **The recipient is a person, not the app**: the readable versions are designed to be read, not re-imported. The structured version exists for backup; importing a file is a separate, later feature.
- **Volume**: a real trip is around 40 places across 9 zones; the design target is three times that.
