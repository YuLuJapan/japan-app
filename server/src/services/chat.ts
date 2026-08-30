// Reading and running the trip's one conversation.
//
// This service owns the *ordering* a turn has to happen in — claim the lock,
// check the budget, persist the question, run the model, record what it cost,
// release the lock — which is why `lib/ai/runtime.ts` deliberately does none of
// it. A runtime that quietly took the budget check would leave this file unable
// to guarantee the rest.
//
// Phase 3 adds the turn itself. This is the read half.

import {
  assertWithinBudget,
  budgetState,
  maxOutputTokens,
  recordTurn,
  type BudgetState,
} from '../lib/ai/budget.js'
import { DEFAULT_CHAT_MODEL, modelMeta } from '../lib/ai/models.js'
import { runAgent } from '../lib/ai/runtime.js'
import type { AiEvent, AiMessage } from '../lib/ai/types.js'
import { buildTripContext } from '../lib/chat-context.js'
import type { ChatMessage, DataStore, Trip } from '../lib/datastore.js'
import { ApiError, validation } from '../lib/errors.js'

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
 *  4. Run the model, streaming as it goes.
 *  5. Record the cost and the answer, then release the lock — on every path,
 *     including failure.
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

  // The thread has to exist before it can be locked. Idempotent, so two first
  // sends racing produce one thread rather than an error.
  await store.createChatThread(tripId)

  const claimed = await store.claimChatTurn(tripId, new Date().toISOString(), TURN_STALE_MS)
  if (!claimed) {
    throw new ApiError(409, 'VALIDATION', 'Someone else on this trip is asking something')
  }

  try {
    await assertWithinBudget(store, context.userId)

    const history = await store.listChatMessages(tripId)
    await store.createChatMessage({
      thread_id: claimed.id,
      trip_id: tripId,
      user_id: context.userId,
      role: 'user',
      content: question,
    })

    const model = DEFAULT_CHAT_MODEL
    const answer: string[] = []

    for await (const event of runAgent({
      model,
      system: buildTripContext(await loadSnapshot(store, context.trip)),
      messages: toAiMessages(history, question, context.author),
      max_output_tokens: maxOutputTokens(),
      max_iterations: maxIterations(),
    })) {
      if (event.type === 'text') {
        answer.push(event.text)
        yield event
      } else if (event.type === 'usage') {
        // Priced and recorded *before* `done` is emitted, so a client that sees
        // `done` and immediately re-reads the conversation gets a budget that
        // already includes the turn it just watched.
        await recordTurn(store, {
          userId: context.userId,
          tripId,
          model,
          vendor: modelMeta(model).vendor,
          usage: event.usage,
        })
        yield event
      } else if (event.type === 'done') {
        // The answer is stored before `done` reaches the browser, for the same
        // reason: the next read must not be missing what was just watched.
        await persistAnswer(store, claimed.id, tripId, answer.join(''))
        yield event
      } else {
        // `searching` and `error` pass straight through. An error ends the turn
        // with whatever text arrived already persisted below.
        if (event.type === 'error') await persistAnswer(store, claimed.id, tripId, answer.join(''))
        yield event
      }
    }
  } finally {
    // Every exit path, success and failure alike. A lock left held would shut
    // the conversation for both travellers until it went stale.
    await store.releaseChatTurn(tripId)
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
  const recent = history.slice(-HISTORY_LIMIT).map((m): AiMessage => ({
    role: m.role,
    content: m.content,
  }))
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
