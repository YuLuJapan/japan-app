// Reading and running the trip's one conversation.
//
// This service owns the *ordering* a turn has to happen in — claim the lock,
// check the budget, persist the question, run the model, record what it cost,
// release the lock — which is why `lib/ai/runtime.ts` deliberately does none of
// it. A runtime that quietly took the budget check would leave this file unable
// to guarantee the rest.
//
// Phase 3 adds the turn itself. This is the read half.

import { budgetState, maxOutputTokens, type BudgetState } from '../lib/ai/budget.js'
import { openMeter } from '../lib/ai/metering.js'
import { DEFAULT_CHAT_MODEL } from '../lib/ai/models.js'
import type { AgentSpec, AiEvent, AiMessage } from '../lib/ai/types.js'
import { buildTripContext } from '../lib/chat-context.js'
import { TableMissingError } from '../lib/datastore.js'
import type { ChatMessage, ChatThread, DataStore, Trip } from '../lib/datastore.js'
import { ApiError, notFound, validation } from '../lib/errors.js'

export interface ChatMessageView {
  id: string
  role: 'user' | 'assistant'
  content: string
  /**
   * Who wrote it: null for the assistant, and null again once an author's
   * account is gone.
   *
   * A removed member keeps their messages — deleting half a dialogue because
   * someone left would make the remaining half unreadable — but the app cannot
   * name an account it no longer holds, so their attribution degrades to
   * "someone" rather than surviving as a name. Decided, not discovered.
   */
  author: { user_id: string; display_name: string } | null
  created_at: string
}

export interface ChatView {
  thread: { id: string; turn_running: boolean } | null
  messages: ChatMessageView[]
  budget: BudgetState
}

/**
 * The whole conversation plus the caller's budget, in one read.
 *
 * One request rather than three because the client polls this on focus and after
 * every send, and a screen that needs three round trips to say anything is a
 * screen that flickers.
 *
 * **The budget is computed here, never on the client.** One number from one
 * source is what stops the notice and the enforcement from ever disagreeing —
 * a client that did its own arithmetic over usage rows could tell someone they
 * had room while the server refused them.
 */
export async function getChat(store: DataStore, tripId: string, userId: string): Promise<ChatView> {
  try {
    return await readChat(store, tripId, userId)
  } catch (err) {
    return asMissingFeature(err)
  }
}

/**
 * Chat's three tables arrive in one migration, so their absence means exactly
 * one thing: 0023 was committed but never run against this project.
 *
 * Answered as 404 — the same "absent, not broken" a missing API key gives, and
 * a sentence the screen already knows how to render. **The operator needs more
 * than the traveller does**, so the actionable half goes to the log: without it
 * this is a generic 500 and somebody spends an evening on it.
 */
function asMissingFeature(err: unknown): never {
  if (err instanceof TableMissingError) {
    console.error(
      `[chat] ${err.message}. Run supabase/migrations/${err.migration} against the project — ` +
        'chat answers 404 until then.'
    )
    throw notFound('Chat')
  }
  throw err
}

async function readChat(store: DataStore, tripId: string, userId: string): Promise<ChatView> {
  const [thread, messages, budget] = await Promise.all([
    store.getChatThread(tripId),
    store.listChatMessages(tripId),
    budgetState(store, userId),
  ])

  return {
    // A trip nobody has asked anything on has no thread yet. Null rather than an
    // invented empty one: the first send creates it, and a read should not write.
    thread: thread ? { id: thread.id, turn_running: !!thread.turn_started_at } : null,
    messages: await toViews(store, messages),
    budget,
  }
}

async function toViews(store: DataStore, messages: ChatMessage[]): Promise<ChatMessageView[]> {
  // One lookup per distinct author, not per message: a long conversation between
  // two people would otherwise be dozens of identical profile reads inside a
  // single serverless invocation.
  const authorIds = [...new Set(messages.map((m) => m.user_id).filter((id): id is string => !!id))]
  const profiles = new Map(
    (await Promise.all(authorIds.map((id) => store.getProfile(id))))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => [p.id, p])
  )

  return messages.map((m) => {
    const profile = m.user_id ? profiles.get(m.user_id) : undefined
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      author: profile
        ? { user_id: profile.id, display_name: profile.display_name || profile.email }
        : null,
      created_at: m.created_at,
    }
  })
}

// --- running a turn ----------------------------------------------------------

/** How long a claimed lock is believed before it is treated as abandoned. */
const TURN_STALE_MS = 2 * 60 * 1000
const MAX_QUESTION_CHARS = 2000
/**
 * How much of the conversation the model is shown.
 *
 * The trip prefix is the expensive part and it is cached; history is not, so it
 * is billed in full on every turn and grows without bound. Twenty messages is
 * several exchanges — enough for "and what about Friday?" to make sense — and
 * caps what an old conversation costs. Older messages stay readable on screen;
 * they simply stop being re-sent.
 */
const HISTORY_LIMIT = 20

const maxIterations = () => {
  const parsed = Number.parseInt(process.env.AI_MAX_ITERATIONS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5
}

/**
 * How many web searches one turn may make.
 *
 * Below `max_iterations` on purpose. The iteration bound is the hard stop that
 * keeps a turn inside the function's duration limit; this is the softer one
 * that keeps a single question from turning into a research project. A turn
 * that wants a sixth search is a turn that should come back and say what it
 * found.
 */
const MAX_WEB_SEARCHES = 3

/** Everything a turn needs that is not the question itself. */
export interface TurnContext {
  trip: Trip
  userId: string
  /** The asker's display name, for attribution in a shared thread. */
  author: string | null
}

/**
 * Run one turn, and emit what the route should forward to the browser.
 *
 * THE ORDER IS THE CONTRACT, and it is why this lives here rather than in the
 * runtime:
 *
 *  1. Claim the lock — so a 409 writes nothing at all.
 *  2. Check the budget — before a single token is spent.
 *  3. Persist the question — so a turn that dies leaves a conversation that
 *     reads honestly, a question with no answer, rather than losing what was
 *     typed.
 *  4. Run the model, recording each event's consequence *before* forwarding it.
 *  5. Release the lock, on every path including failure.
 *
 * Steps 1 and 2 in that order matter: reversed, a capped account would take the
 * lock and then be refused, shutting the conversation for everyone until it went
 * stale.
 */
export async function* runChatTurn(
  store: DataStore,
  context: TurnContext,
  content: unknown
): AsyncIterable<AiEvent> {
  const question = validateQuestion(content)
  const tripId = context.trip.id

  // Outside the try/finally below on purpose: nothing has been claimed yet, so
  // there is nothing to release if this is where it fails.
  const thread = await claimTurn(store, tripId).catch(asMissingFeature)

  try {
    // Opening the meter is the budget gate: it throws before anything below
    // runs, so a capped account's question is never written.
    const meter = await openMeter(store, {
      userId: context.userId,
      tripId,
      capability: 'chat',
    })

    const history = await store.listChatMessages(tripId)
    await saveQuestion(store, thread.id, context, question)

    const answer = answerCollector(store, thread.id, tripId)

    for await (const event of meter.run(await specFor(store, context, history, question))) {
      await answer.record(event)
      yield event
    }
  } catch (err) {
    asMissingFeature(err)
  } finally {
    // Every exit path, success and failure alike. A lock left held would shut
    // the conversation for both travellers until it went stale.
    await store.releaseChatTurn(tripId)
  }
}

/** Take the lock, or refuse. Creating the thread first is idempotent. */
async function claimTurn(store: DataStore, tripId: string): Promise<ChatThread> {
  await store.createChatThread(tripId)
  const claimed = await store.claimChatTurn(tripId, new Date().toISOString(), TURN_STALE_MS)
  if (!claimed) {
    throw new ApiError(409, 'VALIDATION', 'Someone else on this trip is asking something')
  }
  return claimed
}

const saveQuestion = (store: DataStore, threadId: string, context: TurnContext, content: string) =>
  store.createChatMessage({
    thread_id: threadId,
    trip_id: context.trip.id,
    user_id: context.userId,
    role: 'user',
    content,
  })

/** Everything the model is given for this turn. */
async function specFor(
  store: DataStore,
  context: TurnContext,
  history: ChatMessage[],
  question: string
): Promise<AgentSpec> {
  return {
    model: DEFAULT_CHAT_MODEL,
    system: buildTripContext(await loadSnapshot(store, context.trip)),
    messages: toAiMessages(history, question, context.author),
    // US2. A *server-side* tool: it runs on the provider's infrastructure and
    // its results come back in the same response, so there is no search service
    // of ours, no key, no fetcher and no HTML to parse. What stays ours is the
    // framing — the system prompt says a fetched page is information about the
    // world and never an instruction (FR-014).
    web_search: { max_uses: MAX_WEB_SEARCHES },
    max_output_tokens: maxOutputTokens(),
    max_iterations: maxIterations(),
  }
}

/**
 * Builds the answer as it streams, and stores it once the turn ends.
 *
 * Separate from the loop so the ordering guarantee is one readable rule:
 * `record` runs to completion *before* its event is forwarded, so a client that
 * re-reads the moment it sees `done` gets a conversation that already includes
 * the answer it just watched arrive.
 *
 * `searching` and `usage` match nothing here, which is correct — the first has
 * no consequence beyond reaching the screen, and the second belongs to the
 * meter.
 */
function answerCollector(store: DataStore, threadId: string, tripId: string) {
  const parts: string[] = []

  return {
    async record(event: AiEvent): Promise<void> {
      if (event.type === 'text') {
        parts.push(event.text)
      } else if (event.type === 'done' || event.type === 'error') {
        await persistAnswer(store, threadId, tripId, parts.join(''))
      }
    },
  }
}

/** An empty answer is not worth a row: a failed turn leaves the question alone. */
async function persistAnswer(store: DataStore, threadId: string, tripId: string, text: string) {
  if (!text.trim()) return
  await store.createChatMessage({
    thread_id: threadId,
    trip_id: tripId,
    user_id: null,
    role: 'assistant',
    content: text,
  })
}

function validateQuestion(content: unknown): string {
  const errors: string[] = []
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) errors.push('content is required')
  else if (text.length > MAX_QUESTION_CHARS) {
    errors.push(`content must be ${MAX_QUESTION_CHARS} characters or fewer`)
  }
  if (errors.length) throw validation(errors)
  return text
}

/**
 * The conversation as the model sees it: recent history, then the new question.
 *
 * Only the asker's name rides along. The model needs to know who is asking to
 * answer the right person's follow-up; it does not need a name on every past
 * message to follow the thread, and adding one to each would spend tokens on
 * every turn to repeat what the last line already says.
 */
function toAiMessages(
  history: ChatMessage[],
  question: string,
  author: string | null
): AiMessage[] {
  const recent = history
    .slice(-HISTORY_LIMIT)
    .map((m): AiMessage => ({ role: m.role, content: m.content }))
  return [...recent, { role: 'user', content: question, ...(author ? { author } : {}) }]
}

/** One sweep of everything the prefix names. */
async function loadSnapshot(store: DataStore, trip: Trip) {
  const [steps, zones, places, tips, itinerary, shopping, files] = await Promise.all([
    store.listSteps(trip.id),
    store.listZones(trip.id),
    store.listAllPlaces(trip.id),
    store.listAllTips(trip.id),
    store.listItinerary(trip.id),
    store.listShoppingItems(trip.id),
    store.listAllFiles(trip.id),
  ])
  return { trip, steps, zones, places, tips, itinerary, shopping, files }
}
