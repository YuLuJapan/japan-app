// Starting a new conversation.
//
// A trip may hold many threads and exactly one of them is live (migration 0024,
// a partial unique index). "Start over" archives the live one; the next question
// opens a fresh thread, the same path the very first question always took.
//
// Four things are worth protecting, and only the first is about the button
// working:
//
//  1. the screen empties, and its empty state is the one it already had;
//  2. **nothing is deleted** — the old thread and its messages are still in the
//     database, which is the entire difference from what this was first built
//     as, and the only reason re-opening one is possible later;
//  3. **an archived conversation never reaches the model.** This is the sharp
//     one: `listChatMessages` used to be scoped to the trip, and left that way
//     the first answer after starting over would follow on from a conversation
//     the travellers had finished with;
//  4. **the budget does not go with it** — a transcript is not a receipt, and a
//     reset ledger would be the way around the one control that stops this
//     feature spending money.

import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { setAiRuntime } from '../src/lib/ai/runtime.js'
import { createFakeRuntime } from '../src/lib/ai/adapters/fake.js'
import { monthStart } from '../src/lib/ai/budget.js'
import { fixture, OWNER_USER, PARTNER_USER, VIEWER_USER } from './fixture.js'
import { asOwner, asPartner, asViewer, useTestTokens } from './auth.js'

const app = createApp()

let store: DataStore

const ask = (content: string) =>
  asOwner(request(app).post('/api/trips/trip-1/chat/messages')).send({ content })

const startNew = () => asOwner(request(app).post('/api/trips/trip-1/chat/archive'))
const read = () => asOwner(request(app).get('/api/trips/trip-1/chat'))

/** Puts one of the other accounts on trip-1, with everything shared. */
const join = (userId: string, role: 'partner' | 'viewer') =>
  store.upsertTripMember({
    trip_id: 'trip-1',
    user_id: userId,
    role,
    can_see_stays: true,
    can_see_flight: true,
    can_see_documents: true,
    can_see_shopping: true,
  })

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
  setAiRuntime(createFakeRuntime([{ text: 'An answer.' }]).runtime)
})

afterEach(() => {
  setAiRuntime(null)
})

describe('starting a new conversation', () => {
  it('empties the screen', async () => {
    await ask('One')
    await ask('Two')
    expect((await read()).body.messages).toHaveLength(4)

    expect((await startNew()).status).toBe(204)

    const after = await read()
    expect(after.body.messages).toEqual([])
    // The state a trip nobody has asked anything on has always been in, so the
    // screen's existing empty state covers this with no new shape.
    expect(after.body.thread).toBeNull()
  })

  it('opens a genuinely new thread on the next question', async () => {
    await ask('One')
    const first = (await read()).body.thread.id
    await startNew()
    await ask('Starting over')

    const second = (await read()).body.thread.id
    expect(second).not.toBe(first)
    expect((await read()).body.messages).toHaveLength(2)
  })

  it('keeps the old conversation in the database', async () => {
    // The whole point of archiving rather than deleting. Nothing in the app
    // reads this back yet — there is no route and no screen — but the rows are
    // here, so building that later is a read rather than an excavation.
    await ask('One')
    const archived = (await read()).body.thread.id

    await startNew()

    const kept = await store.listChatMessages(archived)
    expect(kept).toHaveLength(2)
    expect(kept[0].content).toBe('One')
  })

  it('leaves only one live thread behind', async () => {
    // The invariant migration 0024 holds with a partial unique index, asserted
    // through the store so the memory half cannot drift from it.
    await ask('One')
    await startNew()
    await ask('Two')
    await startNew()
    await ask('Three')

    expect((await store.getActiveChatThread('trip-1'))!.archived_at).toBeNull()
    expect((await read()).body.messages).toHaveLength(2)
  })

  it('is a no-op on a trip nobody has asked anything on', async () => {
    // Idempotent by construction: a second tap, or two travellers tapping at
    // once, is not a failure anybody should have to explain.
    expect((await startNew()).status).toBe(204)
    expect((await startNew()).status).toBe(204)
  })

  it('leaves another trip’s conversation alone', async () => {
    await ask('One')
    await store.createChatThread('trip-2')
    const other = await store.getActiveChatThread('trip-2')
    await store.createChatMessage({
      thread_id: other!.id,
      trip_id: 'trip-2',
      user_id: OWNER_USER.id,
      role: 'user',
      content: 'Somewhere else',
    })

    await startNew()

    expect(await store.listChatMessages(other!.id)).toHaveLength(1)
    expect(await store.getActiveChatThread('trip-2')).not.toBeNull()
  })
})

describe('what starting over must not do', () => {
  it('does not show the model what was said before it', async () => {
    // The sharp one. `listChatMessages` is scoped to the *thread*; scoped to the
    // trip — as it was before 0024 — the first answer after starting over would
    // follow on from a conversation the travellers had finished with, and
    // "start over" would not start over.
    const { runtime, calls } = createFakeRuntime([{ text: 'An answer.' }])
    setAiRuntime(runtime)

    await ask('Remember this one')
    await startNew()
    calls.specs.length = 0
    await ask('A fresh question')

    const sent = calls.specs[0].messages.map((m) => m.content)
    expect(sent).toEqual(['A fresh question'])
    expect(sent.join(' ')).not.toContain('Remember this one')
  })

  it('does not reset the budget', async () => {
    // `ai_usage` hangs off the account and the trip, never the thread — so an
    // archived conversation still costs what it cost, and this is not a way
    // around the monthly cap.
    await ask('Something expensive')
    const before = await store.sumAiUsageCents(OWNER_USER.id, monthStart(new Date()))
    expect(before).toBeGreaterThan(0)

    await startNew()

    expect(await store.sumAiUsageCents(OWNER_USER.id, monthStart(new Date()))).toBe(before)
    // And the screen is told the same figure it was told before, so nobody
    // reads an empty conversation as a reset allowance.
    expect((await read()).body.budget.spent_cents).toBe(before)
  })

  it('refuses while a turn is running', async () => {
    // Not politeness: the running turn writes its answer when the model
    // finishes, and archiving the thread underneath it lands that answer in a
    // conversation nothing will ever show — watched streaming in, then gone.
    await store.createChatThread('trip-1')
    await store.claimChatTurn('trip-1', new Date().toISOString(), 120_000)

    const res = await startNew()
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('VALIDATION')
  })
})

describe('who may start one', () => {
  it('lets a partner, because a partner may already write to it', async () => {
    await join(PARTNER_USER.id, 'partner')
    await ask('One')
    expect((await asPartner(request(app).post('/api/trips/trip-1/chat/archive'))).status).toBe(204)
    expect((await read()).body.messages).toEqual([])
  })

  it('refuses a viewer, like the rest of chat', async () => {
    // Inherited from `requireChat` on the path — the point of asserting it is
    // that a route added to that router inherits the refusal by construction.
    await join(VIEWER_USER.id, 'viewer')
    expect((await asViewer(request(app).post('/api/trips/trip-1/chat/archive'))).status).toBe(403)
  })
})
