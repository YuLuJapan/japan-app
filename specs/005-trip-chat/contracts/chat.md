# Contract: Chat

**The source of truth for the API remains `specs/001-japan-trip-app/contracts/api.md`.** This file records the two endpoints this feature adds and the guarantees they carry; that file is updated in the same commit.

Both are mounted under `/api/trips/:tripId` inside `tripScopedRouter()`, so `requireTripAccess` has already run: a trip that is not yours answers 404, and a viewer's write is already refused. On top of that the chat router mounts **one** guard on its own path — the idiom `routes/shopping.ts` uses — so a route added under `/chat` later inherits it rather than needing to remember it.

## The two refusals that come before anything

Applied in this order, before any handler runs:

| Condition                         | Status  | Body code   | Why                                                                                                                                                                          |
| --------------------------------- | ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `ANTHROPIC_API_KEY` configured | **404** | `NOT_FOUND` | The feature is **absent**, not broken — as push is with no VAPID keys. This is the real rollout switch (FR-007, FR-008); a client flag hides a button and controls no spend. |
| Caller's role is `viewer`         | **403** | `FORBIDDEN` | Chat is the whole feature for writers only (FR-001, FR-002). They already know the trip exists.                                                                              |

A caller who is not a member never reaches either — `requireTripAccess` answered 404 first (FR-003).

---

## 1. The conversation

```
GET /api/trips/:tripId/chat
```

One read: the thread, its messages oldest-first, and the caller's budget state. Polled on window focus and after a send (research R13) — deliberately not a realtime subscription.

**Response** `200`:

```json
{
  "thread": { "id": "th_1", "turn_running": false },
  "messages": [
    {
      "id": "cm_1",
      "role": "user",
      "content": "What's the plan Thursday?",
      "author": { "user_id": "u_1", "display_name": "Yuval" },
      "created_at": "2026-08-30T09:12:04.000Z"
    },
    {
      "id": "cm_2",
      "role": "assistant",
      "content": "Thursday is your Hakone day…",
      "author": null,
      "created_at": "2026-08-30T09:12:11.000Z"
    }
  ],
  "budget": {
    "spent_cents": 412,
    "cap_cents": 1000,
    "pct": 41,
    "blocked": false,
    "resumes_on": null
  }
}
```

- `author` is `null` for the assistant and carries a display name for a person (FR-006). A member who has since been removed keeps their attribution.
- `thread.turn_running` reflects the lock, so a client that polls while its partner is mid-turn can say so without attempting a send.
- `budget` is computed server-side. **The client does no arithmetic over usage rows** — one number, one source, so the notice and the enforcement can never disagree.
- A trip with no thread yet returns `thread: null` and `messages: []`. The thread is created by the first send, not by a read.

---

## 2. The turn

```
POST /api/trips/:tripId/chat/messages
Content-Type: application/json

{ "content": "What's the plan Thursday?" }
```

**Response** `200`, `Content-Type: text/event-stream`. Headers are flushed before the model is called, so the connection is established while the first tokens are still being produced.

Each frame is one `data:` line carrying one `AiEvent`:

```
data: {"type":"text","text":"Thursday is "}

data: {"type":"searching","query":"Hakone Open Air Museum hours"}

data: {"type":"text","text":"your Hakone day…"}

data: {"type":"usage","input":420,"output":180,"cache_write":0,"cache_read":11840}

data: {"type":"done","message_id":"cm_2","complete":true}
```

### The event union

| `type`      | Carries                  | Means                                                |
| ----------- | ------------------------ | ---------------------------------------------------- |
| `text`      | `text`                   | append to the answer being drawn                     |
| `searching` | `query?`                 | the model is using web search — show it (US2)        |
| `reading`   | `path?`                  | the model is opening a trip file — show it (006)     |
| `usage`     | four token counts        | what the turn cost; priced and written to `ai_usage` |
| `done`      | `message_id`, `complete` | the turn ended                                       |
| `error`     | `code`, `message`        | it failed mid-stream                                 |

**These are this app's events, never the provider's raw stream events** (FR-026). A vendor change must not reach React. The adapter translates; nothing downstream of it knows what an Anthropic delta looks like.

**`done.complete` is FR-013 in one boolean.** `false` means the turn stopped at the five-iteration bound, and the screen must say the answer is incomplete rather than present a truncated one as finished. This is the failure the SDK's tool runner produces by default (research R2), so it is made explicit on the wire.

### Refusals before the stream opens

These are ordinary JSON error envelopes with a status, not stream frames — nothing has been sent yet:

| Status | Code         | When                                                                          |
| ------ | ------------ | ----------------------------------------------------------------------------- |
| `400`  | `VALIDATION` | `content` missing, empty, or over the length limit                            |
| `403`  | `FORBIDDEN`  | the account is at its monthly cap; the message names the resume date (FR-022) |
| `403`  | `FORBIDDEN`  | the global cap is reached (FR-019)                                            |
| `409`  | `VALIDATION` | a turn is already running on this thread (FR-015, research R13)               |
| `429`  | `VALIDATION` | the per-day turn limit for this account is reached (FR-020)                   |

### Failure after the stream opens

Once headers are flushed the status is already `200`, so a mid-turn failure arrives as an `error` **event** and the stream closes. The client renders what it has plus the error; it does not discard partial text, because partial text is what the traveller has been reading.

The user's own message is persisted **before** the model is called, so a failed turn leaves a conversation that reads honestly — a question with no answer — rather than losing what was typed.

---

## Ordering and persistence guarantees

1. The turn lock is claimed **before** the user's message is written. A 409 therefore writes nothing.
2. The user's message is written **before** the model is called.
3. `usage` is recorded and priced **before** `done` is emitted, so a client that sees `done` and immediately re-reads `GET /chat` gets a budget that already includes the turn it just watched.
4. The lock is released in every exit path, including failure. A turn whose function died leaves a stale timestamp, which expires against a staleness window rather than requiring a manual reset.

## What this contract deliberately does not offer

- **No delete, no edit, no clear.** Every mutation in 005 is one append. 006 owns anything else.
- **No per-message endpoint.** The transcript is small and read whole.
- **No streaming of the trip context.** The prefix is server-side and is never sent to the browser — it contains the flight and the shopping list, which the screen already has its own routes for.
- **No `thread_id` in any path.** There is exactly one thread per trip (FR-004), so the trip id is the address. A thread id in the URL would imply a choice that does not exist.
