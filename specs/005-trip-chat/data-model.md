# Phase 1 Data Model: Chat (read-only)

Three new tables in migration **0023**, one new derived shape, and one rule about what may be stored that the whole portability argument rests on.

`0022_itinerary_category.sql` is the highest migration on `main`, verified at the start of this branch. Check again before writing the file — 0019 was claimed twice by parallel branches.

---

## Stored entities (new)

### `chat_threads`

One row per trip. It exists so a conversation has an identity and a lock, not because a trip will ever have two.

| Column            | Type                                             | Notes                                 |
| ----------------- | ------------------------------------------------ | ------------------------------------- |
| `id`              | text pk                                          |                                       |
| `trip_id`         | text, **unique**, fk → `trips` on delete cascade | the uniqueness constraint _is_ FR-004 |
| `turn_started_at` | timestamptz null                                 | the lock (R13). Null when idle        |
| `created_at`      | timestamptz                                      |                                       |
| `updated_at`      | timestamptz                                      | `set_updated_at()` trigger, from 0001 |

**Id convention**, matching every table since `0001_init.sql`: `text` primary keys holding an app-generated
`randomUUID()`. `profiles.id` is the one exception — a real `uuid`, because it comes from Supabase Auth
rather than from us. So `trip_id` is `text` and `user_id` is `uuid` throughout the tables below.

`turn_started_at` is a timestamp rather than a boolean deliberately: a turn whose function died would hold a boolean forever, and the only recovery would be manual. A timestamp is checked against a staleness window, so an abandoned turn expires on its own.

### `chat_messages`

| Column       | Type                                             | Notes                                              |
| ------------ | ------------------------------------------------ | -------------------------------------------------- |
| `id`         | text pk                                          |                                                    |
| `thread_id`  | text fk → `chat_threads` on delete cascade       |                                                    |
| `trip_id`    | text fk → `trips` on delete cascade              | denormalised so a scoped read never needs the join |
| `user_id`    | uuid null fk → `profiles` **on delete set null** | who wrote it; **null for the assistant**           |
| `role`       | text, check in (`user`, `assistant`)             |                                                    |
| `content`    | text                                             | **neutral shape — see the rule below**             |
| `created_at` | timestamptz                                      | ordering                                           |

Index on `(trip_id, created_at)` — the transcript is read whole, oldest first, and only ever for one trip.

`user_id` is what makes US3 work, and the model needs it as much as the screen does: without "Yuval asked", a follow-up gets answered for the wrong person.

**`on delete set null`, not cascade.** A removed member's messages stay in the shared conversation (spec US3 scenario 4) — deleting half a dialogue because someone left would make the remaining half unreadable. The consequence is that their attribution degrades to "someone" rather than surviving as a name, which is the honest outcome once the profile is gone: the app cannot name an account it no longer has. Ordinary for a shared conversation, and decided here rather than discovered.

### `ai_usage`

The ledger. Named for the capability rather than for chat, because it has to outlive this feature (research R6).

| Column       | Type                                      | Notes                                                                           |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `id`         | text pk                                   |                                                                                 |
| `user_id`    | uuid fk → `profiles` on delete cascade    | the account the spend is charged to                                             |
| `trip_id`    | text null fk → `trips` on delete set null | which trip it happened on; nullable because not every future capability has one |
| `capability` | text                                      | `chat` today; `extract`, `image` later                                          |
| `vendor`     | text                                      | `anthropic` today                                                               |
| `model`      | text                                      | the catalogue key, e.g. `anthropic/claude-opus-5`                               |
| `unit`       | text                                      | `tokens` today; `images` later                                                  |
| `quantity`   | jsonb                                     | the raw counters — for tokens: input, output, cache write, cache read           |
| `cost_cents` | numeric(12,4)                             | **computed at write time** from `models.ts`                                     |
| `created_at` | timestamptz                               |                                                                                 |

Index on `(user_id, created_at)` — the monthly sum is the only hot query, and it runs before every turn.

**`trip_id` is nullable and `user_id` is not.** The cap is per account (FR-018): a person with three trips has one budget, not three.

**Why `cost_cents` is stored rather than computed on read**: the cap query would otherwise have to know every historical price, and a rate change would retroactively rewrite what last month cost. Pricing at write time makes the column comparable across vendors and units, which is the entire reason the table is capability-shaped.

**RLS** is enabled on all three with no policies, matching every table since `0001_init.sql` — the server holds the secret key and is the only client.

---

## The rule the portability argument rests on

> **`chat_messages.content` stores our shape, never the provider's.**

Plain text plus `role`, not Anthropic content blocks. This is FR-025, and it is the difference between changing vendor being one file and being a data migration over a live conversation. Persisting provider blocks would put the vendor inside the database, where no adapter can reach it.

The same rule applies at the other edge: the browser receives `AiEvent`, never a raw provider stream event (FR-026). Between the two, everything speaks our vocabulary; the adapter translates at both ends.

---

## Derived shapes (in memory; nothing persisted)

### `AiMessage` — `server/src/lib/ai/types.ts`

```text
AiMessage {
  role: 'user' | 'assistant'
  content: string
  author?: string        // display name, for attribution in the prefix
}
```

What is persisted and what is sent to the adapter, in one shape. No vendor type appears in this file at all — that is checkable by reading it, and enforced for the whole directory by the lint rule.

### `AiEvent` — the wire union

```text
| { type: 'text';      text: string }
| { type: 'searching'; query?: string }
| { type: 'usage';     input, output, cache_write, cache_read: number }
| { type: 'done';      message_id: string; complete: boolean }
| { type: 'error';     code: string; message: string }
```

`done.complete` is FR-013 in one boolean: false when the turn stopped at the iteration bound, so the screen can say the answer is incomplete rather than presenting a truncated one as finished.

`usage` is what `budget.ts` prices and writes to `ai_usage`. It rides the stream rather than being fetched afterwards because the turn is where it is known.

### `ModelMeta` — `server/src/lib/ai/models.ts`

```text
ModelMeta {
  vendor: 'anthropic'
  capability: 'chat'
  context_limit: number
  price: { input, output, cache_write, cache_read: number }   // cents per million tokens
}
```

Held as `Record<ModelId, ModelMeta>` with `ModelId` **derived from the table**. A model without a price or a context limit fails `npm run typecheck` (FR-028, research R9) — the third use of the pattern `export-view.ts` established.

### `BudgetState` — what `GET /chat` reports

```text
BudgetState {
  spent_cents: number
  cap_cents: number
  pct: number
  blocked: boolean
  resumes_on: string | null   // ISO date, first of next month, when blocked
}
```

The client renders the 80% notice and the 100% disabled composer from this alone (FR-021, FR-022). No client-side arithmetic over usage rows — the server owns the number, so the two can never disagree.

---

## What is _not_ stored

- **No prefix, no snapshot.** The trip context is assembled per turn from the live tables. A stored copy would go stale the moment anyone edited a place, and answering from a stale copy is exactly the failure FR-010 exists to prevent.
- **No token counts on `chat_messages`.** Usage belongs to a turn, not a message, and lives in `ai_usage`.
- **No document contents.** The prefix carries document _names_ (FR-011); the bytes never leave the app.
- **No provider request or response bodies.** Nothing that would make the vendor's shape durable.

---

## Datastore interface additions

Added to `DataStore` (`server/src/lib/datastore.ts`), implemented in both backends, never imported concretely:

```text
getChatThread(tripId)                    -> ChatThread | null
createChatThread(tripId)                 -> ChatThread
claimChatTurn(tripId, nowIso, staleMs)   -> ChatThread | null   // null when a live turn holds it
releaseChatTurn(tripId)                  -> void

listChatMessages(tripId)                 -> ChatMessage[]       // oldest first
createChatMessage(input)                 -> ChatMessage

recordAiUsage(input)                     -> AiUsageRow
sumAiUsageCents(userId, sinceIso)        -> number
sumAllAiUsageCents(sinceIso)             -> number              // the global kill switch
```

`claimChatTurn` stamps and returns in one operation, for the same reason `claimDueReminders` does: two overlapping requests must not both believe they hold the lock. Doing it as a read then a write is the race it exists to close.

**The two sums are computed in application code, in both backends.** A Postgres function was written first and removed: the row count is bounded by the very cap it feeds — an account cannot record more spend than the cap before it is blocked — so reading the window and adding it up stays small by construction, while a SQL implementation would be two more objects to apply to the live project and a second version of the cap that the memory store could drift from unnoticed. The Supabase side **pages** through the window rather than taking one response on trust: PostgREST truncates at `db-max-rows` where one is set, and a short read here does not fail — it returns a total that is too small, so the cap never trips and the only symptom is the bill.

There is deliberately **no unscoped `listChatMessages()`** and no unscoped usage sum by trip — the same discipline as `listPushSubscriptionsForUsers`, where an unscoped list is how every reminder once reached every device.
