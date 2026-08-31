# Implementation Plan: Chat (read-only)

**Branch**: `claude/monday-chat-integration-plan-a4hkua` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-trip-chat/spec.md`

## Summary

Put a text box on the trip that can answer questions about it, behind a kill switch, behind a spend cap, and behind a seam that means the vendor is one file.

The surprise on reading the brief against the current API is how much of the hard part is already solved elsewhere. Web search is a **server tool** that runs on Anthropic's infrastructure, so US2 needs no search service, no fetcher and no HTML parsing. The trip fits in a cached prefix, so US1 needs no retrieval tooling. The access rule (`owner || partner`, and writers get the full view) means one thread with no filtering. What is genuinely new is: a table to keep a conversation in, a layer that keeps the vendor at arm's length, a ledger that can count money, and a stream that survives a serverless function.

Seven phases, in dependency order, with the thing that costs money made un-runnable until the thing that stops it exists.

## The three sources this is built from

The Monday item carries three Updates, written in this order, and they do not entirely agree:

1. **The brief** (2026-08-28) — the product decision. Read-only first, one shared thread, $10/month, `chat-bot` default off, native Anthropic SDK behind `lib/agent.ts`.
2. **Spec input** (2026-08-28) — edge cases and the requirements worth stating outright.
3. **A research update** (2026-08-29) — revisits the SDK choice under a question about provider portability, and lands on a conclusion that **changes the migration**: generalise the ledger, not the client.

Where 3 contradicts 1, 3 wins — it was written later and with the migration still unwritten. Where this plan departs from all three, it says so below.

## Where this plan departs from the brief, and why

Six departures. Four are things August could not have known; two are the research update overruling the brief.

### 1. The world question is a server tool, not our code

The brief treats web search as something we build and worry about. It is a **declared tool** (`web_search_20260209`) that executes on the provider's infrastructure and returns results as content blocks in the same response. US2 is one tool declaration and a `max_uses` cap.

The prompt-injection requirement (FR-014) does not go away — it moves. There is no page in our process to mishandle, so the mitigation is entirely in how the system prompt frames fetched content, and the real mitigation remains 006's approval gate for anything that would _act_ on it.

### 2. A bounded manual loop, not `tool_runner`

The brief decided the SDK's tool runner. Two reasons not to, and the second is a correctness bug rather than a preference:

- 005 has **no client-side tools** (departure 4), so the runner would be driving an empty set.
- The runner **does not auto-resume `stop_reason: "pause_turn"`**. A long web-search turn ends exactly that way. The runner only continues after a client tool returns a result, so a paused turn ends the loop and is returned as the final message — no error, no warning, a silently truncated answer presented as a complete one. That is FR-013's failure mode arriving by default.

A manual loop handles `pause_turn` explicitly in about thirty lines, drops a beta dependency and drops `zod`. `AgentSpec` still carries tools, so 006 adds client tools without reshaping the port.

### 3. `effort` is the cost lever, and it postdates the brief

The brief costs a turn at ~$0.02 on a warm cache and concludes $10 buys ~500 turns. At today's published rates for `claude-opus-5` ($5 / $25 per MTok, cached reads about a tenth of input):

|                                    | input   | output  | turn        |
| ---------------------------------- | ------- | ------- | ----------- |
| warm (12K cached prefix, ~800 out) | ~$0.006 | ~$0.020 | **~$0.026** |
| cold (12K uncached)                | ~$0.060 | ~$0.020 | **~$0.080** |

So $10 buys roughly **380 warm turns**, or about 125 if every turn arrives cold. `output_config.effort` did not exist when the brief was written and is a larger lever than any model swap: trip Q&A is retrieval, not reasoning, and `effort: 'low'` cuts the output half of that table hardest.

**The cache TTL matters more than either.** The 5-minute default does not survive making dinner; `cache_control` with `ttl: '1h'` is what keeps two people planning across an evening on the warm row. This is the Anthropic-specific lever the research update names, and it is the concrete reason the native adapter earns its place.

The numbers above are still arithmetic, not measurement. SC-007 requires replacing them with real `usage` data before this is done.

### 4. No client-side trip tools

The whole trip is 8–15K tokens and sits in the cached prefix, so US1 is answered with zero tool calls. A `search_trip` tool would add an iteration and a round trip to every question the prefix already answers, and would make the cache prefix _less_ stable. It earns its place when a trip outgrows the prefix — a 006/011 problem.

### 5. `ai_usage`, not `chat_usage` (research update overrules the brief)

The brief's `chat_usage` is chat-shaped and cannot hold a row for document extraction (007) or image generation (backlog). Three capabilities are already named across the board, and a per-capability ledger means three incomparable tables and no way to ask what the month cost.

`ai_usage` carries `capability`, `vendor`, `model`, `unit`, `quantity` and a `cost_cents` computed at write time from the price table, so the cap sums **one comparable column** across every vendor. This is the change the research update calls "cheap now, expensive later", and it is why it had to be settled before the migration was written.

### 6. `lib/ai/`, not `lib/agent.ts` (research update, scoped by the user)

The brief's single-file seam would have to be dismantled the first time a second capability arrives, because an image generator and a tool-looping chat share no call shape, no inputs, no outputs and no cost unit. The research update's answer is one runtime with a port per capability.

**Settled with the user**: the real structure lands now, carrying **one** capability. `types.ts`, `models.ts`, `runtime.ts`, `budget.ts`, `adapters/anthropic.ts`, `adapters/fake.ts` — and no `extract`/`image` ports written against no caller, and no second adapter library. When 007 needs extraction it adds a port and an adapter; it does not refactor chat.

## Technical Context

**Language/Version**: TypeScript 5, React 18, Node 20 (ESM; relative imports under `server/` carry explicit `.js`)

**Primary Dependencies**: existing — Express, React Router, TanStack Query, Tailwind, Supabase JS, PostHog. New — `@anthropic-ai/sdk`, reachable only from `server/src/lib/ai/adapters/`.

**Storage**: migration **0023** — `chat_threads`, `chat_messages`, `ai_usage`. `0022_itinerary_category.sql` is the highest on `main`, re-verified at the start of this branch.

**Testing**: Vitest, two projects — `server` (node + supertest against `createApp()` with the fixture store and the fake adapter), `web` (jsdom + React Testing Library). Plus `npm run typecheck`, which is where the model catalogue's guard fails, and `npm run lint`, which is where the vendor boundary fails.

**Target Platform**: installed PWA on a phone; Vercel Hobby serverless for the API.

**Project Type**: web application — React SPA + one Express app served two ways (`server/dev.ts`, `api/index.ts`).

## Architecture

### The layer

```
server/src/lib/ai/
  types.ts            AiMessage, AiEvent, AgentSpec, AiUsage — no vendor type appears here
  models.ts           Record<ModelId, ModelMeta>; ModelId derived from the table
  runtime.ts          runAgent(spec) -> AsyncIterable<AiEvent>; setAiRuntime() test seam
  budget.ts           pre-flight check, priced ledger write, global kill switch
  adapters/
    anthropic.ts      the only module importing @anthropic-ai/sdk
    fake.ts           scripted events; every test above the line runs here
```

Three properties, each enforced by something other than discipline:

- **The vendor boundary is an ESLint rule.** `no-restricted-imports` makes `@anthropic-ai/sdk` an error outside `adapters/`, the same way `engine.leaflet.ts` is the only module importing Leaflet. A convention is a code review note; this is a failing build.
- **An unpriced model is a type error.** `ModelId` is derived from the catalogue and `ModelMeta` requires vendor, capability, four prices and a context limit, so `npm run typecheck` refuses a model nobody costed. Third use of the pattern `export-view.ts` established.
- **The test seam is `setAiRuntime()`**, the same idiom as `setDataStore` and `setTokenVerifier`. The suite runs offline and free, which is not a convenience — a test suite that costs money per run stops being run.

### The turn

`services/chat.ts` orchestrates; `lib/chat-context.ts` builds the prefix.

**Prefix stability is load-bearing, and it fails silently.** Caching is a prefix match: any byte change anywhere before the breakpoint invalidates everything after it. So the prefix is assembled in deterministic order, and everything volatile — the question, the timestamp, anything per-request — goes _after_ the last `cache_control` breakpoint. Nothing breaks when this is got wrong; the bill simply triples. SC-008 is the assertion that catches it.

**The loop is bounded at five iterations**, and each `pause_turn` resume spends one. The final `stop_reason` is checked before the answer is presented, so a run that ends at the bound says so (FR-013).

**One turn at a time.** `chat_threads.turn_started_at` is the lock; a second POST gets 409 with a reason. Simplest honest reading of "a turn in flight queues the next" — the client holds the message and offers it again.

### Routes

Mounted inside `tripScopedRouter()`, so access-checked by construction. One `canWrite` + key guard mounted on the `/chat` path — the idiom `routes/shopping.ts` already uses, so anything added under `/chat` later inherits it rather than needing to remember.

| Route                                   | Does                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `GET /api/trips/:tripId/chat`           | thread, messages, budget state — one read, polled on focus and after send |
| `POST /api/trips/:tripId/chat/messages` | the turn, streamed as SSE                                                 |

**No key means 404 on the whole subtree.** Not 500, not 503: with no key the feature is _absent_, exactly as push is with no VAPID keys and analytics with no PostHog token. This is also the real rollout switch — FR-008 — because a client flag hides a button and controls no spend.

### The cap, in three layers

| Layer                           | Control                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Per account, per calendar month | `AI_MONTHLY_CAP_CENTS`, default 1000. Raising it is a deploy, not a code change. |
| Global, per calendar month      | `AI_GLOBAL_CAP_CENTS` — the kill switch the brief did not have.                  |
| Per turn / per day              | a `max_tokens` ceiling and a per-day turn count. Abuse controls, not budgeting.  |

**One limitation stated rather than hidden**: usage is known only _after_ a turn, and the check runs _before_ it, so a single turn can cross the cap. The per-turn ceiling bounds the overshoot to one turn's worth. Closing it entirely would mean a token-counting round trip on every request, buying precision nobody needs at a cost everybody pays.

### The client

- `src/pages/TripChat.tsx` at `/trips/:tripId/chat`, behind `RequireChat` — modelled on `RequireMap`: `chat-bot` defaults **off** and gates the **route** as well as the entry point, so a bookmark is closed too.
- Entry is a **floating Ask button** on the trip screen for `useCanEdit()`. Not a seventh tab: six already forces three labels to shorten (`src/lib/nav-labels.ts`), and a seventh would need a new tier that exists only when two flags are both on — a second thing to undo, which is exactly what R8 of spec 004 was written to avoid. Leaving the nav alone is what keeps `chat-bot` a total rollback.
- **`EventSource` cannot be used.** It is GET-only and cannot carry an `Authorization` header, and every call in this app is bearer-authenticated. `src/api/chat.ts` reads the stream with `fetch` + a `ReadableStream` reader, reusing `getAccessCode()` and the `ApiError` envelope normalisation from `client.ts`.

### Analytics

Declared in `src/lib/analytics-events.ts` **before any call site** — `capture` is typed against the catalogue and will not compile against an undeclared name. `chat_turn_started`, `chat_turn_completed { outcome, iterations, duration_ms }`, `chat_budget_state { pct_bucket }`. Shapes only; `sanitizeProperties` would drop a transcript anyway, and relying on that rather than stating it would be backwards.

## Project Structure

**New**

```
supabase/migrations/0023_chat.sql
server/src/lib/ai/{types,models,runtime,budget}.ts
server/src/lib/ai/adapters/{anthropic,fake}.ts
server/src/lib/chat-context.ts
server/src/services/chat.ts
server/src/routes/chat.ts
server/tests/{chat-access,chat-turn,chat-budget,ai-models}.test.ts
src/api/chat.ts
src/pages/TripChat.tsx
src/tests/chat.test.tsx
```

**Modified** — `server/src/app.ts` (one `router.use`), `server/src/lib/datastore.ts` + both backends, `src/router.tsx` (`RequireChat`), `src/pages/Journey.tsx` (the Ask button), `src/lib/analytics-events.ts`, `eslint.config.js`, `vercel.json`, `package.json`, `.env.example`, `README.md`, `specs/001-japan-trip-app/contracts/api.md`, `CLAUDE.md`.

## Phases

| Phase            | Slice                                                                              | Notes                                      |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| 1 · Setup        | analytics catalogue, env, ESLint boundary, `maxDuration`, contract, dependency     | nothing user-visible changes               |
| 2 · Foundational | migration 0023 + datastore, the whole `lib/ai` layer, access + key guard, the flag | **blocks every story**                     |
| 3 · US1 (P1)     | prefix, turn, SSE, persistence, chat page, Ask button                              | ships alone as the MVP                     |
| 4 · US4 (P2)     | 80% notice, 100% disable with resume date                                          | enforcement is phase 2; this is the notice |
| 5 · US2 (P2)     | `web_search_20260209`, `pause_turn`, the iteration bound                           |                                            |
| 6 · US3 (P2)     | attribution, the turn lock, polling                                                |                                            |
| 7 · Polish       | offline, README, quickstart, CLAUDE.md                                             |                                            |

**Phase 4 precedes phase 5 deliberately.** Web search is what makes a turn expensive; the notice that a turn is expensive should exist before the expensive thing does.

Each phase is independently revertible. Phase 2 leaves no user-visible change at all — the feature is reachable by nobody, which is the correct state for a spend endpoint whose UI does not exist yet.

## Risks

| Risk                                               | Mitigation                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Prefix instability silently triples cost           | SC-008 asserts a non-zero cached read on a second turn; deterministic assembly; nothing volatile before the breakpoint     |
| A paused turn presented as a complete answer       | manual loop; `stop_reason` checked before the answer is shown; FR-013 test                                                 |
| The migration is committed but not applied         | called out as its own task, and in the quickstart — the deployed feature 500s on its first request while every test passes |
| Streaming does not survive the serverless function | `maxDuration` set explicitly; the turn is bounded; the client renders partial text as it lands                             |
| The cost estimate is wrong                         | it is treated as an estimate: SC-007 requires a measured number before this is done                                        |
