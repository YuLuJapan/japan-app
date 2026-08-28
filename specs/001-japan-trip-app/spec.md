# Feature Specification: Japan Trip Companion App

**Feature Branch**: `001-japan-trip-app`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "We want to create an app that will include all the data and information for our trip to Japan. The app will include a front end in react in japanese but modern style. It should contain information regarding the hotels that we will be staying in, the attractions that we will do, restaurants and coffee shops, places that we want to travel to, shopping areas and stores, tips to have in consideration in each zone and place, and so on. Additionally, it should contain some files that we created or collected in advance (via blob storage). In the other end, we will have back end in Node.js serving all of these data. The data base should be free so consider using supabase or mongodb at atlas. We can afford to spend up to 5 dollars in total for this app. It should be responsive and be mobile first. We need to see the journey steps in a simple visualization of our trip."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Browse trip information by zone and category (Priority: P1)

As a traveler, while planning or during the trip, I open the app on my phone and browse all the information collected for the trip, organized by the zones (cities/areas) we will visit and by category: hotels we are staying in, attractions we plan to do, restaurants and coffee shops, shopping areas and stores, and other places we want to travel to. Each place shows its essential details (name, address, description, notes) and any tips relevant to it or to its zone.

**Why this priority**: This is the core value of the app — a single organized source of truth for everything we prepared for the trip, replacing scattered notes, links, and documents.

**Independent Test**: Can be fully tested by loading the app on a mobile phone, navigating to a zone (e.g., Tokyo), selecting a category (e.g., Restaurants), and confirming every prepared entry appears with its details and tips.

**Acceptance Scenarios**:

1. **Given** the app is loaded with trip data, **When** the traveler selects a zone, **Then** they see all categories available for that zone (hotels, attractions, restaurants & cafes, shopping, other places, tips).
2. **Given** a zone is selected, **When** the traveler opens a category, **Then** they see the list of places in that category with name and a short summary, and can open any place to see full details.
3. **Given** a place has tips attached, **When** the traveler views the place, **Then** the tips are visible alongside the place details.
4. **Given** a zone has general tips (not tied to one place), **When** the traveler views the zone, **Then** those zone-level tips are visible.

---

### User Story 2 - See the journey as a simple visualization (Priority: P2)

As a traveler, I want to see the steps of our journey (the ordered sequence of zones/stops with dates) as a simple visual representation — a timeline or step-by-step path — so we can understand at a glance where we are in the trip, what came before, and what comes next.

**Why this priority**: The journey overview gives the trip its structure and is the natural navigation entry point, but it depends on the trip data from Story 1 existing first.

**Independent Test**: Can be tested by opening the journey view and confirming all trip steps appear in the correct order with their dates, and that tapping a step leads to that zone's information.

**Acceptance Scenarios**:

1. **Given** the trip has an ordered list of journey steps, **When** the traveler opens the journey view, **Then** all steps appear in chronological order with zone name and dates.
2. **Given** the journey view is displayed, **When** the traveler taps a step, **Then** they are taken to that zone's detail/browse view.
3. **Given** the trip is in progress (current date falls within the trip), **When** the traveler opens the journey view, **Then** the current step is visually distinguished from past and future steps.

---

### User Story 3 - Edit trip content on the fly (Priority: P3)

As a traveler, during the trip (or while planning), I want to add, edit, or delete places — such as a restaurant we just discovered or an attraction we decided to skip — and their tips, directly from the app on my phone, so the trip information stays accurate as our plans change.

**Why this priority**: Plans change constantly while traveling; keeping content editable in-app keeps the app trustworthy as the single source of truth. It still ranks below browsing and the journey view because the app delivers value on day one with pre-loaded content alone.

**Independent Test**: Can be tested by adding a new restaurant to a zone from a phone, editing its details, confirming it appears in browsing immediately, then deleting it and confirming it is removed.

**Acceptance Scenarios**:

1. **Given** a zone is selected, **When** the traveler adds a new place with a name, category, and details, **Then** the place immediately appears in that zone's category listing.
2. **Given** an existing place, **When** the traveler edits its details or tips, **Then** the updated information is shown wherever the place appears.
3. **Given** an existing place, **When** the traveler deletes it, **Then** the app asks for confirmation before removing it, and afterwards it no longer appears anywhere in the app.
4. **Given** a place was added or edited on one traveler's phone, **When** the other traveler views that zone, **Then** they see the up-to-date content.

---

### User Story 4 - Access pre-collected files and documents (Priority: P4)

As a traveler, I want to open the files we created or collected before the trip (e.g., reservations, itineraries, maps, guides, images) from within the app, attached to the relevant place, zone, or the trip in general, so all supporting material is available in one place while traveling.

**Why this priority**: Valuable convenience that completes the "single source of truth" goal, but browsing structured information (Stories 1–2) delivers the primary value on its own.

**Independent Test**: Can be tested by uploading a set of files in advance, associating them with places/zones, and confirming each can be listed and opened from the app on a mobile device.

**Acceptance Scenarios**:

1. **Given** files were uploaded and associated with a place or zone, **When** the traveler views that place or zone, **Then** the attached files are listed with a recognizable name and type.
2. **Given** a file is listed, **When** the traveler taps it, **Then** the file opens or downloads on their device.
3. **Given** a file is attached to the trip in general (not a specific place), **When** the traveler opens the trip-level documents area, **Then** the file is available there.

---

### Edge Cases

- What happens when a zone has no entries in a category (e.g., no shopping entries for Hakone)? The category should be hidden or shown as empty without breaking navigation.
- What happens when the device is on a slow or intermittent mobile connection (common while traveling)? The app should remain usable, show loading states, and fail gracefully with a retry option.
- What happens when a file attachment is missing or its storage link is no longer valid? The app should show a clear error instead of a blank screen.
- What happens when the trip dates are entirely in the past or future? The journey visualization should still render, with no step marked "current".
- What happens when free-tier storage or database limits are approached? Content volume must stay within free-tier limits (see Assumptions); the system should not silently lose data.
- What happens on very small screens or when the phone is offline in the metro? Core reading experience must work on small viewports; previously loaded content should ideally remain viewable.
- What happens when a traveler accidentally taps delete on a place? Deletion must require confirmation so content is not lost by mistake.
- What happens when both travelers edit the same place at nearly the same time? The last saved change wins; the app must not corrupt data or crash, and the winning version must be what both see afterwards.
- What happens when an edit is submitted while the connection drops? The app must indicate the save failed and allow retrying without losing the entered text.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST organize all trip content under a single trip composed of ordered journey steps, where each step is associated with a zone (city/area) and a date range.
- **FR-002**: System MUST let travelers browse places by zone and by category, with at least these categories: hotels, attractions, restaurants & coffee shops, shopping areas & stores, and other places to visit.
- **FR-003**: Each place MUST support at minimum: name, category, zone, description/notes, address or location reference, and optional external link(s).
- **FR-004**: System MUST support tips at two levels: attached to a specific place, and attached to a zone in general; both MUST be visible when browsing the related place/zone.
- **FR-005**: System MUST display a simple visualization of the journey: the ordered steps of the trip with zone names and dates, rendered as a timeline or equivalent step sequence.
- **FR-006**: The journey visualization MUST allow navigation into each step's zone information, and MUST highlight the current step when the trip is in progress.
- **FR-007**: System MUST store and serve pre-collected files (documents, images, PDFs, etc.) and allow them to be associated with a place, a zone, or the trip in general.
- **FR-008**: Travelers MUST be able to open or download any attached file from the app on a mobile device.
- **FR-009**: The user interface MUST be responsive and designed mobile-first, remaining fully usable on common phone screen sizes, and scaling up to tablet/desktop.
- **FR-010**: The user interface MUST follow a modern Japanese-inspired visual style (clean, minimal, contemporary aesthetic consistent with the trip theme).
- **FR-011**: All structured trip data MUST be served from a central backend/data store (not hard-coded into the user interface), so content can be updated without changing the app itself.
- **FR-012**: System MUST handle empty states (zones without a given category, places without files or tips) gracefully, without errors or broken navigation.
- **FR-013**: System MUST show clear loading and error states, including a retry path, when data or files cannot be fetched.
- **FR-014**: The total cost to build and operate the app for the trip MUST NOT exceed $5 (one-time and cumulative running costs combined); all infrastructure choices MUST prefer free tiers.
- **FR-015**: Travelers MUST be able to add, edit, and delete places (e.g., restaurants, attractions) and their details from within the app, including on a phone during the trip.
- **FR-016**: Travelers MUST be able to add, edit, and delete tips (both place-level and zone-level) from within the app.
- **FR-017**: Deleting a place or tip MUST require an explicit confirmation before the content is removed.
- **FR-018**: Changes made by one traveler MUST be visible to the other traveler on their next view of the affected content, without requiring app reinstallation or manual data sync.
- **FR-019**: If saving a change fails (e.g., connection loss), the system MUST inform the traveler and allow retrying without losing the entered content.

### Key Entities

- **Trip**: The overall journey to Japan; has a name, overall date range, and an ordered collection of journey steps; may have trip-level files and tips.
- **Journey Step**: One stop in the trip sequence; has an order/position, a date range, and is linked to exactly one zone.
- **Zone**: A city or area (e.g., Tokyo, Kyoto, Osaka, Hakone); groups places, zone-level tips, and files.
- **Place**: A specific point of interest belonging to a zone; typed by category (hotel, attraction, restaurant/cafe, shopping, other); holds name, description, address/location, links; may have tips and files.
- **Tip**: A short piece of advice or consideration; attached to either a zone or a specific place.
- **File Attachment**: A document, image, or other file collected in advance; has a display name and type; attached to a trip, zone, or place; stored in blob storage.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A traveler can find the full details of any prepared place (e.g., a specific restaurant in Kyoto) in under 30 seconds and no more than 3 navigation actions from opening the app.
- **SC-002**: The journey overview communicates the full trip structure at a glance: 100% of journey steps visible in order with dates on a single scrollable mobile screen.
- **SC-003**: Any attached file can be opened from the app on a phone in under 10 seconds on a typical mobile connection.
- **SC-004**: The app is fully usable on a phone: all content readable and all actions reachable on small screens without horizontal scrolling.
- **SC-005**: Total money spent on building and running the app for the entire trip is $5 or less.
- **SC-006**: On a typical mobile connection, the main browsing views display their content within 3 seconds.
- **SC-007**: Both travelers can use the app during the trip without assistance: 100% of prepared content (places, tips, files) is reachable through the app's navigation.
- **SC-008**: A traveler can add a new place (e.g., a discovered restaurant) from their phone in under 1 minute, and it is immediately visible when browsing that zone.

## Assumptions

- The app is a private tool for the two travelers (a couple/small group), not a public product; a simple shared access approach is sufficient, and no per-user accounts, roles, or social features are needed.
- The bulk of trip content (journey steps, zones, initial places, tips, files) is prepared and loaded in advance; on top of that, travelers can add, edit, and delete places and tips directly in the app at any time, including mid-trip. The journey structure itself (steps/zones/dates) and file uploads are managed in advance and do not need in-app editing for v1.
- "In Japanese but modern style" refers to a modern, Japanese-inspired visual design (clean, minimal aesthetic); the content language is the travelers' own language (English), with Japanese place names shown where useful. Full Japanese localization of the UI is not required.
- The volume of content (expected dozens of places, tens of tips, and a modest set of files) fits comfortably within free tiers of managed database and file-storage services, supporting the ≤ $5 total budget.
- Travelers have smartphones with internet connectivity in Japan (e.g., eSIM/pocket Wi-Fi); full offline mode is out of scope for v1, though the app should tolerate slow/intermittent connections gracefully.
- The trip has fixed, known dates and an ordered sequence of zones defined before departure; mid-trip restructuring of the journey is not a primary scenario.
- User-stated technology preferences (React front end, Node.js backend, free-tier database such as Supabase or MongoDB Atlas, blob storage for files) are recorded here as constraints for the planning phase; they do not alter the user-facing requirements above.
