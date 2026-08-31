// Reading and running the trip's one conversation.
//
// This service owns the *ordering* a turn has to happen in — claim the lock,
// check the budget, persist the question, run the model, record what it cost,
// release the lock — which is why `lib/ai/runtime.ts` deliberately does none of
// it. A runtime that quietly took the budget check would leave this file unable
// to guarantee the rest.
//
// It also owns *how the trip reaches the model*, which is one decision with two
// answers (`contextFor`): a listing plus a `grep` tool, or the whole trip
// written out. That belongs here rather than in `chat-context.ts` because the
// prefix and the tool list have to be chosen together — a `grep` tool over a
// prefix that already holds the whole trip is paying for both.

import { budgetState, maxOutputTokens, type BudgetState } from '../lib/ai/budget.js'
import { openMeter } from '../lib/ai/metering.js'
import { aiSettings, type AiSettings } from '../lib/ai/settings.js'
import { grepTool } from '../lib/ai/vfs.js'
import type { AgentSpec, AiEvent, AiMessage, AiTool } from '../lib/ai/types.js'
import { buildLazyContext, buildTripContext } from '../lib/chat-context.js'
import { tripFileSystem } from '../lib/chat-files.js'
import type { ChatMessage, ChatThread, DataStore, Trip } from '../lib/datastore.js'
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
  // The cap is a flag, so the figure the screen is told must come from the same
  // resolver the gate enforces — otherwise the notice and the refusal can
  // disagree, which is the one thing computing it server-side was meant to stop.
  const settings = await aiSettings(userId)
  const [thread, messages, budget] = await Promise.all([
    store.getChatThread(tripId),
    store.listChatMessages(tripId),
    budgetState(store, userId, new Date(), settings.monthlyCapCents),
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

/**
 * The hard bound on model iterations in one turn.
 *
 * Eight rather than 005's five, because a turn now spends iterations on reading.
 * The worst ordinary case is: open a file, open a second, search the web, and
 * answer — four, before anything has gone unusually. Five left no room for a
 * turn that also paused mid-search, and the ending it produced is the honest but
 * useless one: "that's where it stopped". The bound is still what keeps a turn
 * inside the function's duration limit, so it is raised rather than removed.
 */
const maxIterations = () => {
  const parsed = Number.parseInt(process.env.AI_MAX_ITERATIONS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8
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

  const thread = await claimTurn(store, tripId)

  try {
    // Resolved once: the same values gate the spend and choose the model, so a
    // flag changing mid-turn cannot split them.
    const settings = await aiSettings(context.userId)

    // Opening the meter is the budget gate: it throws before anything below
    // runs, so a capped account's question is never written.
    const meter = await openMeter(store, {
      userId: context.userId,
      tripId,
      capability: 'chat',
      capCents: settings.monthlyCapCents,
    })

    const history = await store.listChatMessages(tripId)
    await saveQuestion(store, thread.id, context, question)

    const answer = answerCollector(store, thread.id, tripId)

    const spec = await specFor(store, context, history, question, settings)
    for await (const event of meter.run(spec)) {
      await answer.record(event)
      yield event
    }
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
  question: string,
  settings: AiSettings
): Promise<AgentSpec> {
  const { system, tools } = await contextFor(store, context.trip, settings.contextMode)

  return {
    model: settings.model,
    system,
    tools,
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
 * How the model reaches the trip — the prefix, and the tools that go with it.
 *
 * The two modes are a strategy, not a branch that leaks: each returns the same
 * pair, and nothing downstream asks which one it got. The tool list is part of
 * that pair rather than a separate decision, because declaring `grep` over a
 * prefix that already contains the whole trip is how a model ends up paying for
 * both.
 *
 * **Lazy reads nothing.** The trip row is already in hand from
 * `requireTripAccess` and the listing is a fixed table, so the seven datastore
 * reads that used to happen before every turn now happen only for the files the
 * model actually opens — usually one, often none.
 */
async function contextFor(
  store: DataStore,
  trip: Trip,
  mode: AiSettings['contextMode']
): Promise<{ system: string; tools: AiTool[] }> {
  if (mode === 'eager') {
    return { system: buildTripContext(await loadSnapshot(store, trip)), tools: [] }
  }
  const files = tripFileSystem(store, trip)
  return { system: buildLazyContext(trip, files.manifest()), tools: [grepTool(files)] }
}

/**
 * Builds the answer as it streams, and stores it once the turn ends.
 *
 * Separate from the loop so the ordering guarantee is one readable rule:
 * `record` runs to completion *before* its event is forwarded, so a client that
 * re-reads the moment it sees `done` gets a conversation that already includes
 * the answer it just watched arrive.
 *
 * `searching`, `reading` and `usage` match nothing here, which is correct — the
 * first two have no consequence beyond reaching the screen, and the third
 * belongs to the meter.
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

/**
 * One sweep of everything the eager prefix names.
 *
 * Seven reads before a word is asked, which is the cost the lazy prefix exists
 * to remove — so this now runs only when the `ai-chat-context` flag has rolled
 * back to `eager`.
 */
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
