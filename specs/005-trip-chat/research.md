# Phase 0 Research: Chat (read-only)

Everything asserted about the existing code was read out of the repository; everything asserted about the Anthropic API was read out of current documentation rather than recalled. Each decision records what was rejected, because the rejections are the part that stops being obvious in three months.

---

## R1 — Web search is a server tool. US2 is a declaration, not a subsystem.

**Decision**: declare `web_search_20260209` with a `max_uses` cap. Build no search integration.

**Rationale**: the tool executes on Anthropic's infrastructure and returns `web_search_tool_result` blocks in the same response — no client-side execution loop, no API key of our own, no HTML to fetch or parse. The `_20260209` variant (with dynamic filtering) requires Opus 5 / 4.8 / 4.7 / 4.6, Sonnet 5 or Sonnet 4.6; we are on `claude-opus-5`, so it is available.

**Consequences worth stating**:

- FR-014 (fetched pages are data, never instructions) does not disappear, it relocates. There is no page in our process to mishandle, so the whole mitigation is how the system prompt frames the tool's results — and the durable mitigation stays 006's approval gate, which is where anything would _act_ on what a page said.
- Server-tool errors **do not raise**. They come back HTTP 200 with an error object in the result block's `content`. For web search a success `content` is a list and an error `content` is an object, so the adapter branches on that before indexing.
- Do **not** also declare a code-execution tool: the `_20260209` variants run code execution under the hood, and a second execution environment confuses the model.

**Alternatives considered**:

- _A search API of our own (Brave, Serper, Tavily)._ Rejected: a second key, a second bill, a second failure mode, and a fetcher we would have to write, to reproduce something already in the response.
- _No web access at all in 005._ Rejected: it is a whole user story, and the marginal cost is one tool declaration.

---

## R2 — A bounded manual loop, not the SDK's tool runner. This one is a correctness argument.

**Decision**: write the agentic loop by hand in `adapters/anthropic.ts`, bounded at five iterations, handling `pause_turn` explicitly.

**Rationale**: the brief chose `client.beta.messages.toolRunner`. Two things make it the wrong fit here, and the second is a bug rather than a preference:

1. **There is nothing for it to run.** 005 declares no client-side tools (R4). The runner exists to drive the call-execute-loop cycle for tools you define.
2. **The runner does not auto-resume `pause_turn`.** A long-running server-tool turn can stop with `stop_reason: "pause_turn"`; the runner only continues after a _client_ tool produces a result, so a paused turn ends the loop and is returned as the final message — no error, no warning, just a truncated answer. Web search is precisely the thing that triggers it. Mixing server tools into the runner therefore requires checking `stop_reason` on every iteration and pushing the paused assistant turn back by hand — at which point the runner is saving nothing and hiding a failure mode.

The manual loop is roughly thirty lines, drops a beta dependency, and drops `zod` (the runner's ergonomic path is `betaZodTool`).

**Consequences**: `AgentSpec` still carries a tool list, so 006 adds client tools without reshaping the port. If 006 wants the runner then, it can have it behind the same port — the decision is adapter-local, which is the point of the layer.

**Alternatives considered**:

- _`toolRunner` with `stream: true` and a manual `pause_turn` check._ Rejected: same code we would write anyway, plus a beta surface and a dependency, to save a `while` loop.

---

## R3 — `effort`, then cache TTL, then model. In that order.

**Decision**: `claude-opus-5`, `output_config: { effort: 'low' }`, `cache_control` with `ttl: '1h'`.

**Rationale**: at published rates for `claude-opus-5` — $5/MTok input, $25/MTok output, cached reads about a tenth of input — a turn over a 12K prefix producing ~800 output tokens costs about **$0.026 warm** and about **$0.080 cold**. The brief's ~$0.02 and ~500 turns are optimistic; $10 is nearer **380 warm turns**.

Ranking the levers by what they actually buy here:

1. **`effort: 'low'`** — output is the expensive half of that table ($0.020 of $0.026), and trip Q&A is retrieval, not reasoning. Effort did not exist when the brief was written.
2. **`ttl: '1h'`** — the difference between the warm and cold rows is threefold. The 5-minute default TTL does not survive making dinner; an hour covers an evening's planning.
3. **The model** — `claude-sonnet-5` would be ~2.5× cheaper, and is a one-string change in `models.ts` if the measured numbers demand it. Not taken: the brief chose Opus and quality on the P1 story is what the feature is judged on.

**The cost model is less portable than the code.** Explicit `cache_control` breakpoints over the trip prefix are an Anthropic-specific lever, and they are what makes the arithmetic work at all. This is the concrete reason the native adapter earns its place over a generic translation layer.

**Consequences**: SC-007 requires the estimate to be replaced with a measured number. SC-008 requires a non-zero `cache_read_input_tokens` on a second turn — if it is zero, something is invalidating the prefix and the real cost is the cold row.

---

## R4 — The trip goes in the prefix. No retrieval tools.

**Decision**: assemble the whole trip into the cached system prefix. Declare no `search_trip` / `get_day_plan` / `list_places` tools.

**Rationale**: 39 places, 9 zones, the day plan, tips, the flight and the shopping list come to roughly 8–15K tokens. Cached, that is ~$0.006 a turn and **zero iterations** — US1 is answered by the first response. A retrieval tool would add a full round trip to every question the prefix already answers, and would make the cached prefix _less_ stable, since the tool list is part of the cache key.

**Consequences**: the assumption has a ceiling. A trip several times this size would want tools and a smaller prefix. That is a 006/011 problem and the port already accommodates it.

**Alternatives considered**:

- _Tools for everything, minimal prefix._ Rejected on cost and latency at this size, and it is the shape that scales — so it is the shape to adopt when size demands it, not before.
- _A summarised prefix._ Rejected: summarising is where invented answers come from, and FR-010 is the story's whole point.

---

## R5 — Prefix stability is the failure mode nobody notices

**Decision**: assemble the prefix deterministically — fixed section order, rows in the datastore's own order, no timestamps, no per-request identifiers — and put the question and everything volatile _after_ the last `cache_control` breakpoint.

**Rationale**: caching is a prefix match, and render order is `tools` → `system` → `messages`. Any byte change anywhere in the prefix invalidates everything after it. The classic invalidators are a clock reading in the system prompt, a non-deterministically ordered map, and a varying tool set. **None of them fail loudly.** The answer is still correct; the bill is three times larger.

This is why SC-008 is a success criterion rather than an implementation note: the only signal is `usage.cache_read_input_tokens`, and nothing looks wrong until someone reads it.

**Consequences**: `lib/chat-context.ts` owns assembly and does no formatting that depends on now. A test asserts that building the prefix twice from the same trip produces identical bytes — cheap, and it catches an unsorted map before it costs anything.

---

## R6 — `ai_usage`, decided before the migration, not after

**Decision**: one ledger table named for capability rather than for chat: `capability`, `vendor`, `model`, `unit`, `quantity`, `cost_cents` computed at write time from `models.ts`.

**Rationale**: three AI capabilities are already named across the board — chat and its tool loop (005/006, Anthropic), document extraction (007, "PDFs go to the model natively"), image generation (backlog, Google). A `chat_usage` table cannot hold an image row: the units differ (tokens with a cache-read discount, versus images priced one to two orders of magnitude higher), and per-capability tables mean no single query can answer what the month cost.

Pricing at write time rather than at read time is what makes the sum work: `cost_cents` is comparable across vendors and units, and a later price change does not silently rewrite history.

**Consequences**: the cap sums one column. Per-capability sub-caps become a `where` clause rather than a schema change — worth having before image generation, which could otherwise eat the chat budget in a handful of calls.

**Alternatives considered**:

- _`chat_usage` now, a second table later._ Rejected by the research update's own argument: cheap now, expensive later, and the migration is the moment it is cheap.
- _Store raw token counts and price at read time._ Rejected: the cap query then has to know every historical price, and a rate change retroactively changes what last month cost.

---

## R7 — Store a neutral message, stream a neutral event

**Decision**: `chat_messages.content` is text in our own shape, never Anthropic content blocks. The SSE wire carries our event union — `text`, `searching`, `usage`, `done`, `error` — never the provider's raw stream events.

**Rationale**: these are the two places a vendor choice would become permanent. Persisting provider content blocks turns a future vendor change into a data migration over live history; emitting provider stream events puts the vendor's vocabulary inside React components. Neither is undone by an adapter, because both have escaped the adapter.

**Consequences**: the adapter translates in both directions, which is the work the layer exists to contain. FR-025 and FR-026 exist to make this checkable rather than aspirational.

---

## R8 — The vendor boundary is a lint rule, not a convention

**Decision**: an ESLint `no-restricted-imports` entry makes `@anthropic-ai/sdk` an error anywhere outside `server/src/lib/ai/adapters/`.

**Rationale**: this repository already has the precedent and already trusts it — `engine.leaflet.ts` is the only module importing Leaflet, and that is what makes swapping the map library one file. A boundary that lives in a comment survives until the first person in a hurry.

**Consequences**: `npm run lint` is now part of the feature's correctness story, not just its tidiness. Same shape as `npm run typecheck` carrying the export's field policy.

---

## R9 — An unpriced model is a compile error

**Decision**: `models.ts` holds `Record<ModelId, ModelMeta>` with `ModelId` **derived from the table**, and `ModelMeta` requiring vendor, capability, four prices and a context limit.

**Rationale**: third use of the pattern `export-view.ts` established and `place-view.ts` repeated. A model reaching the runtime without a price means the ledger writes a zero and the cap never trips — a silent failure of the one control that stops this feature costing money. Making it a `typecheck` failure means it cannot be added without someone deciding what it costs.

Keys are namespaced (`anthropic/claude-opus-5`) so the vendor is readable at the call site. **Role aliases were rejected**: indirection hides the one thing most worth seeing, which is which model at what cost.

---

## R10 — Streaming through the existing Express function

**Decision**: SSE written directly from the Express handler — `Content-Type: text/event-stream`, `flushHeaders()`, one `data:` frame per event. `maxDuration` set explicitly in `vercel.json`.

**Rationale**: `api/index.ts` exports the whole Express app as one Vercel function, and Node-runtime functions stream. Serverless functions on Hobby accept a `maxDuration` between 1 and 60 seconds (Fluid compute raises the ceiling to 300); the default is well below either, so it must be set rather than assumed. The turn is bounded at five iterations for the same reason — a duration limit is not a plan.

**Consequences**: `maxDuration` is set on the single function, so it applies to every API route. That is a ceiling rather than a reservation, and costs nothing for routes that return in milliseconds.

**Alternatives considered**:

- _A separate Edge function for chat._ Rejected: a second runtime, a second auth path, and the Express app is where `requireTripAccess` lives — the property the whole backend is built around.
- _Poll for a completed answer instead of streaming._ Rejected: FR-012, and a 20-second silence on a phone is indistinguishable from a broken app.

---

## R11 — `EventSource` cannot be used

**Decision**: read the stream on the client with `fetch` + `ReadableStream`, not `EventSource`.

**Rationale**: `EventSource` issues a GET and cannot set an `Authorization` header. Every call in this app is bearer-authenticated (`src/api/client.ts`), and the turn is a POST carrying the message. Neither is negotiable, and putting a token in a query string to satisfy the API would put it in every access log.

**Consequences**: `src/api/chat.ts` is a small reader rather than a hook over `api.post`, and it reuses `getAccessCode()` and the error-envelope normalisation so a 401 still behaves like every other 401.

---

## R12 — A floating button, not a seventh tab

**Decision**: enter chat from a floating Ask button on the trip screen, plus the route. Do not add a nav tab.

**Rationale**: `src/lib/nav-labels.ts` already shortens three labels at six tabs, and its comment explains why that shortening is a _function of the count_ rather than a separate edit — it is what makes turning `show-map` off a total rollback. A writer with both `show-map` and `chat-bot` on would have seven tabs, about 45px each at 320px, requiring a new label tier that exists only in that combination. That is a second thing to undo, which is the exact failure R8 of spec 004 was written to prevent.

**Consequences**: `nav-labels.ts` is untouched, and `chat-bot` remains a single-switch rollback. The brief's "viewers get no tab" is honoured in substance — viewers get no entry point at all.

**Alternatives considered**:

- _A seventh tab._ Rejected above.
- _An icon in the app header._ Rejected: the header already duplicates the search magnifier on the map screen, and spec 009 restyles that header — this would land in the one place about to move.

---

## R13 — One turn at a time, by lock

**Decision**: `chat_threads.turn_started_at` is a lock. A POST while a turn is running gets 409 with a stated reason; the client keeps the message and offers it again.

**Rationale**: the spec input says "a turn in flight queues the next rather than firing two loops at one context". Two concurrent turns against one conversation produce two answers to interleaved histories and bill for both. A lock on the thread is the smallest thing that prevents it, and it is checkable.

**Consequences**: a crashed turn must not hold the lock forever — the timestamp is checked against a staleness window rather than a boolean flag, so an abandoned turn expires rather than requiring a manual reset.

**Alternatives considered**:

- _A real queue._ Rejected: infrastructure for a two-person conversation, and "your partner is asking something" is a better answer than a silent wait.
- _Supabase realtime._ Rejected by the brief and agreed here: more moving parts than two people need. Polling on focus and after send covers US3.
