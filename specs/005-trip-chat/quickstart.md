# Quickstart: proving Chat works

How to verify each phase, in the order it ships. Every step names what should happen; a step that does something else is a defect, not a surprise.

## Prerequisites

```bash
npm install          # adds @anthropic-ai/sdk from phase 1
npm run dev          # web on :3000, API on :3001
```

Local dev uses the in-memory store seeded from `server/src/data/placeholder-data.json` — 39 places, 9 zones, and edits that live until the process restarts. That is the right place to try everything below; the chat tables live in the same store and reset with it.

### Two switches, and only one of them controls spend

| Switch              | Where                     | Off means                                           |
| ------------------- | ------------------------- | --------------------------------------------------- |
| `ANTHROPIC_API_KEY` | server env                | **every chat endpoint 404s.** The real control.     |
| `chat-bot`          | PostHog flag, default off | no Ask button, no `/chat` route. A rollout control. |

With no `VITE_POSTHOG_PROJECT_TOKEN` there is no answer to the flag, so the default applies and chat is invisible in local dev. To work on it, flip the default to `true` in the two call sites (`src/pages/Journey.tsx` and the `RequireChat` guard in `src/router.tsx`) and **flip it back before committing** — the same dance `export-trip` and `show-map` already need.

For a local key, put it in `.env.local` (git-ignored, loaded by `server/dev.ts`):

```
ANTHROPIC_API_KEY=sk-ant-...
AI_MONTHLY_CAP_CENTS=1000
AI_GLOBAL_CAP_CENTS=5000
```

## The whole gate, before any commit

```bash
npm test            # both projects, offline, free
npm run typecheck   # not optional — the model catalogue fails here, not in the tests
npm run lint        # not optional either — the vendor boundary fails here
npm run format
```

Two of those carry correctness for this feature rather than tidiness. `npm test` transpiles types away, so it cannot see an unpriced model; `npm run typecheck` is the only thing that runs that guard. And `@anthropic-ai/sdk` leaking out of `adapters/` is a lint error by design (research R8), so a green test suite says nothing about whether the boundary still holds.

---

## Phase 2 — it can run, and cannot overspend

Nothing is visible yet. That is the correct state for a spend endpoint whose UI does not exist.

### 2a. The migration is committed. Is it applied?

```bash
grep -c "create table" supabase/migrations/0023_chat.sql   # 3
```

**Committing it is not deploying it.** The Supabase project has no migration runner. Run `0023` against the live project (SQL editor, or the Supabase MCP `apply_migration`) as a separate act. Skip it and every test still passes while the deployed feature 500s on its first real request — because tests use the memory store.

### 2b. Absent, not broken

With `ANTHROPIC_API_KEY` unset:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  localhost:3001/api/trips/trip-1/chat        # 404
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  localhost:3001/api/trips/trip-1/reminders   # 200 — nothing else changed
```

A 500 here is the bug this shape exists to prevent.

### 2c. The door

With a key set, against the fixture accounts:

- owner → `200`
- partner → `200`
- **viewer → `403`** (FR-002)
- an account in no membership → **`404`**, not 403 (FR-003)

### 2d. The suite costs nothing

```bash
npm test
```

Runs with no key and no network. If a test ever needs one, the seam is wrong: `setAiRuntime()` should be the only thing the tests touch.

---

## Phase 3 — ask about my own trip

### 3a. Grounded, and honest when it isn't

Open a trip, tap **Ask**, and try both halves:

- "What's the plan for Thursday?" → names what is actually stored for that day.
- "What did we save in Kyoto?" → the real list.
- "What time is the flight?" / "What's left on the shopping list?" → **answered.** A writer is being told what a writer can already see (FR-011).
- "Tell me about the ramen place in Osaka" — when no such place is saved → says it isn't in the trip. **An invented answer here is the failure this story exists to prevent** (FR-010).

### 3b. Progressive, not silent

Watch the first send. Words should begin appearing within a few seconds (SC-003). A long pause followed by a complete answer means the stream is being buffered somewhere — check that `flushHeaders()` runs before the model is called.

### 3c. Offline

Kill the network with the chat open, then reload:

- the conversation so far is still readable,
- the composer says chat needs a signal,
- **nothing spins** (FR-016).

### 3d. The cost model, measured

This is SC-007 and SC-008, and it is the step most worth not skipping.

Send one question, then a second one in the same minute. Read the `usage` event on the **second**:

```
{"type":"usage","input":420,"output":180,"cache_write":0,"cache_read":11840}
```

- `cache_read` **must be non-zero**. Zero means something is invalidating the prefix — a clock reading, an unsorted map, a varying tool set (research R5) — and the real cost is roughly threefold the estimate.
- Compute the turn's cost from `models.ts` prices and **put the measured number in `spec.md`**, replacing the estimate. The brief's `$0.02 / 500 turns` is arithmetic; this is data.

Then wait an hour and ask again. `cache_read` should still be non-zero — that is the `ttl: '1h'` doing the thing the whole cost argument rests on.

---

## Phase 4 — never be surprised by the bill

Test this with **seeded ledger rows, not with money.**

```bash
# in the memory store, insert ai_usage rows summing to 810 cents against the fixture owner
```

- below 80% → nothing about the budget is mentioned;
- at 80% → a quiet notice, nothing blocked;
- at 100% → composer disabled with a resume date, **transcript still readable**, and every other screen normal (SC-009);
- roll the clock to the first of next month → the previous month's rows no longer count.

Also confirm the global cap independently: seed a second account past `AI_GLOBAL_CAP_CENTS` and confirm the first account is refused too.

---

## Phase 5 — ask about the world

- "Is the Ghibli Museum open on Mondays?" → a web-sourced answer, with the searching state visible while it happens.
- Force the iteration bound (a question needing several searches) → the answer arrives marked incomplete. **A truncated answer presented as finished is the exact failure `pause_turn` produces by default** (research R2), so this is the case to try deliberately rather than hope for.

---

## Phase 6 — one conversation, two people

Two browsers, two fixture accounts, one trip:

1. Send from the owner. Open on the partner → the message is there, attributed to the owner.
2. Ask a follow-up from the partner → the answer accounts for what the owner asked, and for who asked it.
3. Send from both at once → the second gets "a turn is already running", not a second turn.
4. Leave a tab in the background, send from the other, refocus → the new message arrives without a manual reload (SC-010).

---

## Rolling back

The whole feature is one flag and one key:

- Turn `chat-bot` off in PostHog → the button and the route go. The tab bar is untouched, because chat never took a tab (research R12).
- Unset `ANTHROPIC_API_KEY` → the endpoints 404 and nothing can spend.

Neither leaves anything else to undo. The tables stay; a conversation nobody can reach costs nothing.
