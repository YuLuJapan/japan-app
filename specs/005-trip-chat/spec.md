# Feature Specification: Chat (read-only)

**Feature Branch**: `claude/monday-chat-integration-plan-a4hkua`

**Created**: 2026-08-30

**Status**: Draft

**Input**: Monday board "Onward — Next Four", group `005 · Chat (read-only)` — feature brief, spec-input notes and a research update on item "◆ FEATURE — Chatbot", plus the foundational item and four user-story items. Feature description: "A chat that knows the trip: ask about it, search the web, and later manage it. Phase 3 is read-only on purpose — it lands the key, the spend cap, streaming and cost telemetry with nothing destructive attached. Owners and partners only, one shared thread per trip, $10/month cap on real token usage. Native Anthropic SDK behind a seam. Behind `chat-bot` (default off). Writes and file ingest are Phase 4."

Clarifications settled with the user before writing: the AI layer lands as a real `lib/ai/` structure carrying **one** capability, with the usage ledger generalised to `ai_usage` from day one; chat is entered from a **floating Ask button**, not a seventh nav tab; the model is `claude-opus-5` at low effort with a one-hour cache TTL; the cached trip prefix carries **everything a writer can see**, including the flight and the shopping list.

---

## Why this is three features, and why only one of them ships here

One text box does three jobs: **ask** ("when does the Ghibli Museum open?", "what is the plan Thursday?"), **do** ("add a ramen place in Shibuya"), and **ingest** (drop a reservation PDF in and have it become a trip entry). They look like one feature and cost like three, so they ship in that order. This spec is **ask only**.

Read-only first is not timidity. It introduces four things the app has never had — a server-side API key, a spend cap, streaming inside a serverless function, and cost telemetry — with nothing destructive attached while we learn what a turn actually costs. Writes and file ingest are Phase 4 (006/007), where they share the review-and-approve screen with import.

## What makes this small

Access does. `canWrite` is `owner || partner`, and writers always get the full view — the `can_see_*` flags are _ignored_ for them, not merely unset (`server/src/lib/trip-view.ts`). Restricting chat to those two roles means everyone who can open it already sees the whole trip, so **a shared transcript can reveal nothing**.

Everything follows from that one fact: one thread per trip, no per-user threads, no viewer thread, no filtering of history, no redaction of the prefix. Viewers get no entry point and a 403. A feature that admitted viewers would need every one of those things, and would be a different, much larger spec.

---

## User Scenarios & Testing _(mandatory)_

### Foundational Work - The chat can run, and cannot overspend (Priority: Foundational — blocks every story below)

Before any story can put a request on the wire there must be somewhere to store a conversation, a seam the tests can run against without a network or a bill, a door that refuses viewers, and a cap that stops the spending. None of it is a story a traveller can be shown; every story below is reckless without it.

The cap is the part that cannot be deferred. This is the first feature in the app that costs money per use, and the first where a bug is not a broken screen but an invoice. A loop that retries a failing tool call fifty times costs what fifty conversations cost, and nothing in the app today would notice.

**Why this priority**: it is not demonstrable, and shipping any story before it is shipping an uncapped spend endpoint.

**Independent Test**: with no API key configured, confirm the chat endpoints answer 404 and the rest of the app is untouched. With a key, confirm a viewer is refused, an outsider cannot tell the trip exists, and a seeded ledger past the cap refuses a turn before it reaches the model.

**Acceptance Scenarios**:

1. **Given** a deployment with no API key, **When** anything calls the chat endpoints, **Then** they answer 404 — the feature is absent, not broken — and no other endpoint changes behaviour.
2. **Given** a member whose role is viewer, **When** they call any chat endpoint, **Then** they are refused with 403 and are offered no entry point in the app.
3. **Given** an account that is not a member of the trip, **When** they call any chat endpoint, **Then** they get 404, which does not confirm the trip exists.
4. **Given** an account whose recorded spend this month is already at the cap, **When** they send a message, **Then** the request is refused before it reaches the model, and the refusal says when it resumes.
5. **Given** the test suite, **When** it runs, **Then** no request leaves the machine and nothing is billed.

---

### User Story 1 - Ask a question about my own trip (Priority: P1)

A traveller wants to ask what is planned for Thursday, or which restaurants they saved in Kyoto, and get an answer from their actual trip, instead of scrolling to find something they already saved.

**Why this priority**: this is the job the feature exists for, and it ships alone as the MVP. The other three make it better; none of them make it work.

**Independent Test**: ask about a place that exists in the trip and confirm the answer comes from the trip's own data; ask about a place that does not and confirm the answer says so rather than inventing one.

**Acceptance Scenarios**:

1. **Given** a trip with saved places and a day plan, **When** the traveller asks what is planned for a given day, **Then** the answer names what is actually stored for that day.
2. **Given** the same trip, **When** the traveller asks about somewhere they never saved, **Then** the answer says it is not in the trip rather than inventing an entry.
3. **Given** a question in flight, **When** the answer is being produced, **Then** it appears progressively rather than after a silence, and the traveller can tell the difference between thinking and being stuck.
4. **Given** a traveller with no connection, **When** they open chat, **Then** the conversation so far is readable and the app says chat needs a signal — it does not spin.
5. **Given** a trip whose flight and shopping list are stored, **When** the traveller asks about either, **Then** they are answered — a writer is being told what a writer can already see.

---

### User Story 2 - Ask about the world, not just my trip (Priority: P2)

A traveller wants to ask about opening hours, closures, or whether somewhere is worth the trip, without leaving the app to find out.

**Why this priority**: it doubles what the box is good for, but the trip half is useful on its own and is where the answers are trustworthy.

**Independent Test**: ask something that is not in the trip data and confirm a web-sourced answer arrives within the tool-use cap; confirm a turn that hits the cap says so rather than presenting a partial answer as complete.

**Acceptance Scenarios**:

1. **Given** a question the trip data cannot answer, **When** the traveller asks it, **Then** the answer draws on the web and the traveller can see that it is doing so while it happens.
2. **Given** a turn that reaches the tool-use limit, **When** it stops, **Then** the traveller is told the answer is incomplete rather than shown a truncated answer as if it were finished.
3. **Given** a fetched page containing text that reads like an instruction, **When** it is used in an answer, **Then** it is treated as information about the world and not as a command.

---

### User Story 3 - Pick up the conversation my partner started (Priority: P2)

The second traveller wants to see and continue what the other one asked, so planning is one conversation rather than two.

**Why this priority**: it is what makes the thread shared rather than merely single. Safe by construction, because chat is writers-only and writers see everything.

**Independent Test**: send a message from one account, open the trip on the other, confirm the message appears attributed to its author, and confirm a follow-up is answered with the earlier exchange in context.

**Acceptance Scenarios**:

1. **Given** a message sent by one traveller, **When** the other opens the chat, **Then** it is there, attributed to whoever wrote it.
2. **Given** a conversation started by one traveller, **When** the other asks a follow-up, **Then** the answer accounts for what was already asked, and by whom.
3. **Given** a turn already running, **When** the other traveller sends a message, **Then** they are told a turn is in progress rather than starting a second one against the same conversation.
4. **Given** a member who has since been removed from the trip, **When** the remaining travellers read the thread, **Then** their earlier messages are still there and still attributed. This is ordinary for a shared conversation; it is decided rather than discovered.

---

### User Story 4 - Never be surprised by the bill (Priority: P2)

The owner wants to know when the month's chat budget is nearly gone, and to have it stop rather than keep billing, so a runaway loop cannot cost them money.

**Why this priority**: the enforcement is Foundational and lands before any story. This story is the part the traveller can see — the warning and the honest stop.

**Independent Test**: drive recorded usage past 80% and confirm the notice appears; past 100% and confirm the composer disables with a resume date while the rest of the app is untouched and the history stays readable.

**Acceptance Scenarios**:

1. **Given** recorded spend below 80% of the cap, **When** the traveller opens chat, **Then** nothing about the budget is mentioned.
2. **Given** recorded spend at or past 80%, **When** they open chat, **Then** a quiet notice says how much is left. It does not block anything.
3. **Given** recorded spend at or past 100%, **When** they open chat, **Then** the composer is disabled and says when it resumes, the transcript is still readable, and every other screen in the app behaves normally.
4. **Given** a new calendar month, **When** the first request is made, **Then** the previous month's spend no longer counts against the cap.
5. **Given** a turn that used the model, **When** it finishes, **Then** what it cost is recorded from real token usage rather than estimated from message count.

---

## Requirements _(mandatory)_

### Access and identity

- **FR-001** Chat MUST be limited to owners and partners — the whole feature, not merely its writes.
- **FR-002** A viewer MUST be refused with 403 and offered no entry point in the app.
- **FR-003** A caller who is not a member of the trip MUST get 404, never 403.
- **FR-004** There MUST be exactly one thread per trip, shared by its writers.
- **FR-005** The trip a turn operates on MUST come from the request path, never from anything the model produces.
- **FR-006** Every message MUST record who wrote it, and that attribution MUST be visible to the other traveller and available to the model.

### Availability and rollout

- **FR-007** With no server API key configured, every chat endpoint MUST answer 404 and no other endpoint may change behaviour.
- **FR-008** The client-side flag MUST gate the entry point and the route. It is a rollout control and MUST NOT be relied on as a spend control.
- **FR-009** The flag MUST default to off, so an unreachable or deleted flag reads as "not rolled out" rather than "shipped".

### The answer

- **FR-010** An answer about the trip MUST be grounded in the trip's stored data, and MUST NOT invent entries that are not there.
- **FR-011** The context given to the model MUST carry everything a writer can see — steps, zones, places including stays, tips, the day plan, the flight and the shopping list — and MUST carry document names only, never document contents.
- **FR-012** An answer MUST appear progressively, so a slow turn is distinguishable from a stuck one.
- **FR-013** A turn MUST be bounded to at most five model iterations, and a turn that stops at the bound MUST say the answer is incomplete rather than present it as finished.
- **FR-014** Content fetched from the web MUST be treated as data about the world, never as instructions.
- **FR-015** While a turn is running for one traveller, another traveller's send MUST be refused with a stated reason rather than starting a second turn against the same conversation.
- **FR-016** With no connection the transcript MUST remain readable and the app MUST say chat needs a signal.

### Spend

- **FR-017** Spend MUST be counted from real token usage reported by the provider, not from message count.
- **FR-018** Spend MUST be summed per account per calendar month, and checked **before** a request is made.
- **FR-019** There MUST be a global cap in addition to the per-account cap, so one account cannot become the whole bill.
- **FR-020** A turn MUST carry a per-turn output ceiling and there MUST be a per-day turn limit per account.
- **FR-021** At or past 80% of the per-account cap the traveller MUST be told, without being blocked.
- **FR-022** At or past 100% the composer MUST be disabled with a resume date, the transcript MUST stay readable, and the rest of the app MUST be unaffected.
- **FR-023** Both caps MUST be configurable without a code change.
- **FR-024** The usage record MUST be shaped so that a future non-chat capability can be counted in the same column — it MUST name the capability, the vendor, the model, the unit and the quantity, and MUST store a cost computed at write time.

### Portability

- **FR-025** Stored messages MUST use a vendor-neutral shape, so changing provider is not a migration over live history.
- **FR-026** The events sent to the browser MUST be this app's own vocabulary, never the provider's raw stream events.
- **FR-027** The provider SDK MUST be importable from exactly one directory, enforced mechanically rather than by convention.
- **FR-028** A model MUST NOT be usable without a recorded price and context limit, and that MUST fail the type check rather than at runtime.

### Analytics

- **FR-029** Analytics MUST carry shapes only — never message text, question text, or any answer. A transcript is trip content.

---

## Success Criteria _(mandatory)_

- **SC-001** A traveller can ask what is planned for a day and get a correct answer from their own trip without opening any other screen.
- **SC-002** A question about somewhere not in the trip is answered honestly rather than plausibly.
- **SC-003** The first words of an answer appear within a few seconds of sending, on a phone.
- **SC-004** A viewer can find no way into chat, and cannot reach it by URL.
- **SC-005** Turning the flag off returns the app exactly to its previous state, with nothing else to undo.
- **SC-006** The whole test suite runs with no API key, no network access and no cost.
- **SC-007** The measured cost of a typical turn is recorded in this spec from real usage data before the feature is considered done — the number the brief estimated is replaced, not assumed.
- **SC-008** A second turn on a warm conversation reports a non-zero cached-read on its usage. If it does not, the cost model is wrong by roughly threefold and the cause is found before shipping.
- **SC-009** An account at the cap sees a disabled composer and a readable transcript, and every other screen behaves normally.
- **SC-010** Two travellers see one conversation, correctly attributed, without either having to reload the app by hand.

---

## Assumptions

- The two travellers on a trip are the realistic load. The cost model assumes a warm cache from two people planning in the same evening; a many-user deployment would need it re-measured, which is noted below rather than solved.
- A trip's data fits comfortably in a cached prefix. At 39 places and 9 zones it is roughly 8–15K tokens. A trip large enough to break that assumption is a later problem and would be answered with tools, not a bigger prefix.
- The provider's web search is sufficient for US2. No separate search service is needed.

## Out of scope

- Any write. Adding, editing or deleting anything from chat is 006.
- File ingest. Turning a reservation PDF into a trip entry is 007.
- Per-user threads, viewer access, or any filtering of history — all made unnecessary by the access rule above.
- Realtime push of a partner's message. Polling on focus and after send is enough for two people.
- Cross-vendor failover mid-turn.

## Noted, and deliberately not solved here

The research update on the Monday item raises a consequence larger than this spec: the project's `$0 target, $5 ceiling, Vercel Hobby + Supabase Free` premise does not survive multiple users — Hobby is non-commercial-use only, and Supabase Free pauses on inactivity. That is a hosting decision, it is on no board group, and nothing in this spec depends on its answer. It is recorded here so it is not discovered later.
