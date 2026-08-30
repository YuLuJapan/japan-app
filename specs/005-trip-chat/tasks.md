---
description: 'Task list for the Chat (read-only) feature'
---

# Tasks: Chat (read-only)

**Input**: Design documents from `/specs/005-trip-chat/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/chat.md](./contracts/chat.md), [quickstart.md](./quickstart.md)

**Tests**: Included. This repository ships 1103 tests and treats them as the contract (`CLAUDE.md`). Tests are listed **before** the code they cover wherever that is honest. Two are not: T012 (watching the model-catalogue guard fail) and T019 (an access check the router already applies by construction) lock in behaviour rather than drive it, and pass the moment the code they cover exists — that is the point of them.

**Two gates that are not tests.** `npm run typecheck` carries FR-028 (an unpriced model) and `npm run lint` carries FR-027 (the vendor boundary). Neither is visible to `npm test`, so both run before every commit.

**Organization**: by user story, in the priority order the spec sets. The seven phases in `plan.md` map onto the sections below one-to-one.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: the user story the task serves (US1–US4). Setup, Foundational and Polish carry no story label.
- Every task names the exact file it touches.

## Path Conventions

Web application, existing layout: React SPA in `src/`, one Express app in `server/src/` served by `server/dev.ts` and `api/index.ts`, tests in `src/tests/` (jsdom) and `server/tests/` (node).

Relative imports under `server/` carry explicit `.js` extensions. No semicolons, single quotes, 100 columns — run `npm run format` rather than hand-wrapping.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the six things every later phase assumes. All independent of each other except T006.

- [x] T001 [P] Declare `chat_turn_started`, `chat_turn_completed { outcome, iterations, duration_ms }` and `chat_budget_state { pct_bucket }` in `src/lib/analytics-events.ts`, in a commented section beside the export events. Declare them **before** any call site exists — `capture` is typed against this catalogue and will not compile against an undeclared name. No message text, question or answer is ever a property (FR-029).
- [x] T002 [P] Add `ANTHROPIC_API_KEY`, `AI_MONTHLY_CAP_CENTS`, `AI_GLOBAL_CAP_CENTS`, `AI_MAX_ITERATIONS` and `AI_DAILY_TURN_LIMIT` to `.env.example`, with the optional-at-runtime note push and PostHog already carry: **no key means the feature is absent, not broken.**
- [x] T003 [P] Add a `no-restricted-imports` rule to `eslint.config.js` making `@anthropic-ai/sdk` an error everywhere except `server/src/lib/ai/adapters/**`. Same discipline as `engine.leaflet.ts` (research R8). Verify it fails before it passes.
- [x] T004 [P] Add `functions: { "api/index.ts": { "maxDuration": 60 } }` to `vercel.json`. 60s is the Hobby ceiling for a serverless function; the default is far below it, so it must be set rather than assumed (research R10). It applies to the single function and therefore to every route — a ceiling, not a reservation.
- [x] T005 [P] Document both chat endpoints in `specs/001-japan-trip-app/contracts/api.md` — the contract source of truth, referenced by code comments on both sides. Include the two pre-handler refusals (404 with no key, 403 for a viewer) and the SSE event union.
- [x] T006 Add `@anthropic-ai/sdk` to `package.json` dependencies and install.

**Checkpoint**: nothing user-visible has changed. `npm test`, `npm run typecheck` and `npm run lint` all pass, and T003's rule has been seen to fail on a deliberate bad import.

---

## Phase 2: Foundational — the chat can run, and cannot overspend (Blocking Prerequisites)

**Purpose**: somewhere to keep a conversation, a seam the tests run against for free, a door that refuses viewers, and a cap that stops the spending. This is the first feature in the app where a bug is an invoice rather than a broken screen.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete. Shipping any story before it is shipping an uncapped spend endpoint.

**Serves**: the spec's Foundational block, FR-001 to FR-009 and FR-017 to FR-028.

### The database

- [x] T007 Write `supabase/migrations/0023_chat.sql` — `chat_threads`, `chat_messages`, `ai_usage` per [data-model.md](./data-model.md), RLS enabled with no policies, index on `ai_usage (user_id, created_at)`. **Re-check the highest migration number on `main` first**: 0019 was claimed twice by parallel branches.
- [ ] **T008 — OUTSTANDING, OWNED BY THE USER.** Apply 0023 to the live Supabase project (SQL editor, or the Supabase MCP `apply_migration`). A separate act from committing it — skip it and every test passes while the deployed feature 500s on its first real request.
- [x] T009 [P] Add `ChatThread`, `ChatMessage`, `AiUsageRow` and the nine methods in [data-model.md](./data-model.md) to the `DataStore` interface in `server/src/lib/datastore.ts`. No unscoped list, and no unscoped usage sum by trip — the same discipline as `listPushSubscriptionsForUsers`.
- [x] T010 Implement them in `server/src/lib/datastore.memory.ts`. `claimChatTurn` stamps and returns in one operation, like `claimDueReminders` — a read-then-write is the race it exists to close.
- [x] T011 Implement them in `server/src/lib/datastore.supabase.ts`, including the monthly sum as one query rather than a fetch-and-add.

### The AI layer

- [x] T012 [P] Write `server/tests/ai-models.test.ts` — every catalogue entry has a vendor, a capability, four prices and a context limit; every `ModelId` resolves to an adapter. Then delete a price and **watch `npm run typecheck` fail**, which is the guard this test cannot see (FR-028).
- [x] T013 `server/src/lib/ai/types.ts` — `AiMessage`, `AiEvent`, `AgentSpec`, `AiUsage`. **No vendor type appears in this file**, which is checkable by reading it.
- [x] T014 `server/src/lib/ai/models.ts` — `Record<ModelId, ModelMeta>` with `ModelId` **derived from the table**, keys namespaced `anthropic/claude-opus-5`, prices in cents per million tokens including both cache rates. No role aliases (research R9).
- [x] T015 `server/src/lib/ai/adapters/fake.ts` — scripted `AiEvent` sequences, including a `done { complete: false }` run and a mid-stream `error`. Every test above the adapter line runs here.
- [x] T016 `server/src/lib/ai/adapters/anthropic.ts` — **the only module importing the SDK.** The bounded manual loop, explicit `pause_turn` resume, `cache_control` at `ttl: '1h'`, `output_config: { effort: 'low' }`, translation into `AiEvent`, and `usage` extraction. Server-tool errors arrive as HTTP 200 with an error object in the result block, so branch on that rather than expecting a throw (research R1).
- [x] T017 `server/src/lib/ai/budget.ts` — the pre-flight check against `AI_MONTHLY_CAP_CENTS`, the global check against `AI_GLOBAL_CAP_CENTS`, and the priced ledger write from `models.ts`. State the known limitation in a comment: usage is known after a turn and checked before it, so one turn can cross the cap and the per-turn ceiling is what bounds the overshoot.
- [x] T018 `server/src/lib/ai/runtime.ts` — `runAgent(spec)` returning `AsyncIterable<AiEvent>`, resolving model → adapter, wrapping budget, telemetry and `ApiError` mapping. `setAiRuntime()` is the test seam, same idiom as `setDataStore`.

### The door

- [x] T019 [P] Write `server/tests/chat-access.test.ts` — viewer 403, outsider 404, owner and partner 200, and **404 on every chat route when no key is configured** while another route is unaffected. Also assert a route added under `/chat` inherits the guard.
- [x] T020 `server/src/routes/chat.ts` with the `canWrite` + key guard mounted on the path (the `routes/shopping.ts` idiom), wired into `tripScopedRouter()` in `server/src/app.ts`. Handlers stubbed; phase 3 fills them.
- [x] T021 [P] `RequireChat` in `src/router.tsx` — `chat-bot` default **off**, gating the route as well as the entry point, modelled line for line on `RequireMap`.

**Checkpoint**: chat is reachable by nobody and the cap is enforceable before a single request goes on the wire. `npm test`, `npm run typecheck`, `npm run lint` pass.

---

## Phase 3: US1 — Ask a question about my own trip (Priority: P1)

**Goal**: a traveller asks what is planned for Thursday and gets an answer from their own trip.

**Independent Test**: ask about a place that exists and one that does not; the first is answered from trip data, the second is not invented.

**Ships alone as the MVP.**

- [x] T022 [P] [US1] Write `server/tests/chat-turn.test.ts` against the fake adapter: the event union reaches the client in order, both messages are persisted, a `done { complete: false }` is reported as incomplete, and a mid-stream failure leaves the user's message stored with no assistant reply.
- [x] T023 [US1] `server/src/lib/chat-context.ts` — the prefix, in **deterministic order**, carrying everything a writer can see: steps, zones, places including stays, tips, the day plan, the flight, the shopping list, and document **names only** (FR-011). Nothing volatile, no clock reading (research R5). Add a test that building it twice from the same trip produces identical bytes.
- [x] T024 [US1] `server/src/services/chat.ts` — get-or-create the thread, claim the lock, persist the user's message **before** calling the model, run the turn, persist the answer, record usage, release the lock in every exit path.
- [x] T025 [US1] The SSE writer in `server/src/routes/chat.ts`: `flushHeaders()` before the model is called, one `data:` frame per `AiEvent`, **our union and never a raw provider event** (FR-026).
- [x] T026 [US1] `GET /api/trips/:tripId/chat` — thread, messages and budget state in one read, per [contracts/chat.md](./contracts/chat.md). The server owns the budget number; the client does no arithmetic over usage rows.
- [x] T027 [P] [US1] `src/api/chat.ts` — the stream reader on `fetch` + `ReadableStream`, **not `EventSource`**, which is GET-only and cannot carry a bearer token (research R11). Reuse `getAccessCode()` and the `ApiError` envelope normalisation from `client.ts` so a 401 behaves like every other 401.
- [x] T028 [US1] `src/pages/TripChat.tsx` — transcript, composer, the answer drawn as it streams, and the incomplete-answer notice when `done.complete` is false.
- [x] T029 [US1] The floating Ask button on `src/pages/Journey.tsx`, for `useCanEdit()` only and behind `chat-bot`. **Do not touch `src/lib/nav-labels.ts`** — leaving the nav alone is what keeps the flag a total rollback (research R12).
- [x] T030 [P] [US1] Write `src/tests/chat.test.tsx` — renders history, streams an answer, offers no button to a viewer, and shows the offline state without spinning.

**Checkpoint**: US1 is independently shippable. The app can answer a question about the trip.

---

## Phase 4: US4 — Never be surprised by the bill (Priority: P2)

**Goal**: the traveller is warned before the budget is gone, and stopped rather than billed when it is.

**Enforcement already exists (T017).** This phase is the part a person can see.

**Before phase 5 deliberately**: web search is what makes a turn expensive, and the notice should exist before the expensive thing does.

- [x] T031 [P] [US4] Write `server/tests/chat-budget.test.ts` — the 80% and 100% boundaries, calendar-month rollover, ledger arithmetic against the price table, the global cap refusing an account under its own cap, the per-day turn limit, and that a capped account's transcript still reads.
- [x] T032 [US4] Budget state on `GET /chat`: spent, cap, percentage, blocked, and the resume date (the first of next month) when blocked.
- [x] T033 [US4] The 80% notice and the 100% disabled composer with its resume date in `src/pages/TripChat.tsx`. **Paused, not broken** — the transcript stays readable and no other screen changes (FR-022).

---

## Phase 5: US2 — Ask about the world (Priority: P2)

**Goal**: opening hours and closures answered without leaving the app.

- [x] T034 [US2] Declare `web_search_20260209` with `max_uses` in the agent spec (`server/src/lib/ai/adapters/anthropic.ts` / the spec built in `services/chat.ts`). Do **not** also declare a code-execution tool — the `_20260209` variants run it under the hood. Say in the system prompt that fetched pages are information about the world, never instructions (FR-014).
- [x] T035 [US2] `pause_turn` resume and the five-iteration bound, with a test that a run ending at the bound emits `done { complete: false }`. **This is the failure the SDK's tool runner produces silently** (research R2), so it is asserted rather than assumed.
- [x] T036 [US2] The "searching the web" state in `src/pages/TripChat.tsx`, driven by the `searching` event.

---

## Phase 6: US3 — Pick up my partner's conversation (Priority: P2)

**Goal**: one conversation, two people.

- [x] T037 [US3] Attribution: the author's display name on every message in the API response and on screen, and in the prefix handed to the model — without it a follow-up gets answered for the wrong person. A removed member keeps their attribution.
- [x] T038 [US3] The turn lock and its 409, with a staleness window so a turn whose function died expires rather than needing a manual reset (research R13). The composer explains it rather than failing silently.
- [x] T039 [US3] Poll `GET /chat` on window focus and after a send. Deliberately not Supabase realtime — more moving parts than two people need.

---

## Phase 7: Polish

- [x] T040 Offline: cached transcript readable, "chat needs a signal", **no spinner** (FR-016).
- [x] T041 A "Chat" section in `README.md` covering the key, both caps and the flag, matching how "Reminders & notifications" documents push.
- [x] T042 The `CLAUDE.md` architecture note — the vendor boundary, why the ledger is capability-shaped rather than chat-shaped, and the two gates (`typecheck`, `lint`) that carry correctness for this feature.
- [ ] **T043 — OUTSTANDING, NEEDS A REAL KEY.** Replace the cost estimate with a measured number in `spec.md` and `plan.md` (SC-007), and confirm `cache_read_input_tokens` is non-zero on a second turn (SC-008). If it is zero, find the invalidator before shipping — the real cost is roughly threefold the estimate.

---

## Dependencies

- **Phase 1** → everything. T001 before any `capture` call; T003 before T016 (the rule must exist before the import it governs).
- **Phase 2** → every story. T007 → T008 → T010/T011. T013 → T014 → T015/T016 → T017 → T018. T009 before T010 and T011.
- **Phase 3** depends on all of phase 2. T023 → T024 → T025/T026. T027 → T028 → T029.
- **Phase 4** depends on T017 (enforcement) and T026 (somewhere to report it).
- **Phase 5** depends on T016 and T035's bound; independent of phase 4 in code, sequenced after it in ship order.
- **Phase 6** depends on T024 (the lock) and T026 (the read).
- **T043** depends on a real key and a real turn — it is the last thing, and it is not optional.

## Parallel opportunities

- T001–T005 all together.
- T009 alongside T012, T013.
- T019 alongside T020's implementation.
- T022, T027, T030 alongside their phase-3 siblings.
- T031 alongside T032.
