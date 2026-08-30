// Reading and running the trip's one conversation.
//
// This service owns the *ordering* a turn has to happen in — claim the lock,
// check the budget, persist the question, run the model, record what it cost,
// release the lock — which is why `lib/ai/runtime.ts` deliberately does none of
// it. A runtime that quietly took the budget check would leave this file unable
// to guarantee the rest.
//
// Phase 3 adds the turn itself. This is the read half.

import { budgetState, type BudgetState } from '../lib/ai/budget.js'
import type { ChatMessage, DataStore } from '../lib/datastore.js'

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
