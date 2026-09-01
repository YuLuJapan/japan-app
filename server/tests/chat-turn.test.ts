// One turn, end to end, against the fake adapter.
//
// What is asserted here is mostly *ordering*, because ordering is what the
// service exists to guarantee and what a refactor is most likely to lose:
// the lock before the write, the question before the model, the cost before
// `done`. None of those show up as a wrong answer — they show up as a
// conversation that reads oddly, or a budget that lags a turn behind.

import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { setAiRuntime } from '../src/lib/ai/runtime.js'
import { createFakeRuntime, type FakeTurn } from '../src/lib/ai/adapters/fake.js'
import { fixture, OWNER_USER } from './fixture.js'
import { asOwner, useTestTokens } from './auth.js'

const app = createApp()

let store: DataStore

/** Installs a script and hands back the specs the runtime was called with. */
function script(turns: FakeTurn[]) {
  const { runtime, calls } = createFakeRuntime(turns)
  setAiRuntime(runtime)
  return calls
}

/** Parses an SSE body into the event objects it carried. */
function events(body: string): Record<string, unknown>[] {
  return body
    .split('\n\n')
    .map((frame) => frame.replace(/^data: /, '').trim())
    .filter(Boolean)
    .map((json) => JSON.parse(json) as Record<string, unknown>)
}

const ask = (content: unknown) =>
  asOwner(request(app).post('/api/trips/trip-1/chat/messages')).send({ content })

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
  script([{ text: 'Thursday is your Hakone day.' }])
})

afterEach(() => {
  setAiRuntime(null)
})

/**
 * The live conversation's messages, read straight from the store.
 *
 * A helper rather than `listChatMessages('trip-1')`, because that read is
 * scoped to a **thread** since 0024 — a trip holds every conversation it has
 * ever had, and a trip-scoped read would hand back the archived ones too.
 */
async function storedMessages(tripId = 'trip-1') {
  const thread = await store.getActiveChatThread(tripId)
  return thread ? store.listChatMessages(thread.id) : []
}

describe('a successful turn', () => {
  it('streams text, then usage, then done', async () => {
    const res = await ask('What is the plan Thursday?')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')

    const types = events(res.text).map((e) => e.type)
    expect(types).toEqual(['text', 'text', 'usage', 'done'])
    expect(events(res.text).at(-1)).toMatchObject({ type: 'done', complete: true })
  })

  it('carries the answer in fragments the client appends', async () => {
    // Two `text` events, not one: the screen has to append rather than replace,
    // and a fixture that sent the answer whole would never catch a client that
    // replaced.
    const res = await ask('What is the plan Thursday?')
    const text = events(res.text)
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join('')
    expect(text).toBe('Thursday is your Hakone day.')
  })

  it('persists both messages, question first', async () => {
    await ask('What is the plan Thursday?')
    const messages = await storedMessages()
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[0]).toMatchObject({
      content: 'What is the plan Thursday?',
      user_id: OWNER_USER.id,
    })
    // The assistant has no author — null rather than a synthetic account.
    expect(messages[1]).toMatchObject({ content: 'Thursday is your Hakone day.', user_id: null })
  })

  it('creates exactly one thread, however many turns are taken', async () => {
    await ask('One')
    await ask('Two')
    const messages = await storedMessages()
    const threads = new Set(messages.map((m) => m.thread_id))
    expect(threads.size).toBe(1)
  })

  it('records what the turn cost before it says done', async () => {
    await ask('What is the plan Thursday?')
    // The guarantee is that re-reading immediately after `done` already includes
    // the turn just watched — otherwise the budget always lags by one.
    const res = await asOwner(request(app).get('/api/trips/trip-1/chat'))
    expect(res.body.budget.spent_cents).toBeGreaterThan(0)
  })

  it('releases the lock so the next question can be asked', async () => {
    await ask('One')
    const after = await store.getActiveChatThread('trip-1')
    expect(after?.turn_started_at).toBeNull()

    const second = await ask('Two')
    expect(second.status).toBe(200)
  })

  it('reports the thread as idle once the turn is over', async () => {
    await ask('One')
    const res = await asOwner(request(app).get('/api/trips/trip-1/chat'))
    expect(res.body.thread.turn_running).toBe(false)
  })
})

describe('what the model is given', () => {
  it('is a listing and a grep tool, and the question attributed to whoever asked', async () => {
    const calls = script([{ text: 'ok' }])
    await ask('Where are we staying in Tokyo?')

    const spec = calls.specs[0]
    // The trip's front matter and the paths — not the trip. What is *in* a file
    // arrives only if the model opens one.
    expect(spec.system).toContain('/trip/saved.json')
    expect(spec.system).toContain('Country: Japan')
    expect(spec.tools?.map((t) => t.name)).toEqual(['grep'])
    expect(spec.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'Where are we staying in Tokyo?',
      author: 'Yuval',
    })
  })

  it('leaves the trip itself out of the prefix', async () => {
    // The whole point, asserted as an absence. `Ramen Bar` is a fixture place,
    // so finding it here would mean the eager prefix had come back — which is
    // not a wrong answer, just a bill nobody agreed to.
    const calls = script([{ text: 'ok' }])
    await ask('anything')

    expect(calls.specs[0].system).not.toContain('Ramen Bar')
    expect(calls.specs[0].system).not.toContain('SAVED PLACES')
    // Small enough to state as a number: a few hundred tokens against 8–15K.
    expect(calls.specs[0].system.length).toBeLessThan(3000)
  })

  it('carries the conversation so far, so a follow-up has context', async () => {
    await ask('First question')
    const calls = script([{ text: 'ok' }])
    await ask('And the second?')

    const roles = calls.specs[0].messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'user'])
  })

  it('builds the same prefix twice for an unchanged trip', async () => {
    // Byte-identical, or the cached prefix is invalidated on every turn and the
    // real cost is roughly threefold the estimate. Nothing else reports this:
    // the answers stay correct and only the bill changes (research R5).
    const calls = script([{ text: 'ok' }, { text: 'ok' }])
    await ask('One')
    await ask('Two')
    expect(calls.specs[0].system).toBe(calls.specs[1].system)
  })

  it('declares the same tool twice, byte for byte', async () => {
    // Tool definitions sit above the system block in the cached prefix, so a
    // description that mentioned the trip would re-bill the whole thing on every
    // turn — and, like every other cache failure, would look like nothing at all.
    const calls = script([{ text: 'ok' }, { text: 'ok' }])
    await ask('One')
    await ask('Two')
    expect(JSON.stringify(toolShapes(calls.specs[0]))).toBe(
      JSON.stringify(toolShapes(calls.specs[1]))
    )
  })
})

/** A tool as the provider is told about it — `run` is ours and is not sent. */
const toolShapes = (spec: { tools?: { name: string; description: string }[] }) =>
  (spec.tools ?? []).map((t) => ({ name: t.name, description: t.description }))

describe('rolling back to the eager prefix', () => {
  // `ai-chat-context=eager` is the lever for a model that reads badly in front
  // of real travellers. These are 005's own assertions, kept: what they protect
  // is that the rollback still *works*, not that anyone expects to need it.
  beforeEach(() => {
    process.env.AI_CHAT_CONTEXT = 'eager'
  })
  afterEach(() => {
    delete process.env.AI_CHAT_CONTEXT
  })

  it('writes the whole trip out, and declares no tools', async () => {
    const calls = script([{ text: 'ok' }])
    await ask('Where are we staying in Tokyo?')

    expect(calls.specs[0].system).toContain('SAVED PLACES')
    expect(calls.specs[0].system).toContain('THE JOURNEY')
    // No `grep` over a prefix that already holds the trip: that would pay for
    // both.
    expect(calls.specs[0].tools).toEqual([])
  })

  it('includes the flight and the shopping list', async () => {
    // Both are things a *writer* can already see, and refusing to answer "what
    // time is our flight?" would be a feature that looks broken (FR-011).
    const calls = script([{ text: 'ok' }])
    await store.updateTrip('trip-1', {
      flight: {
        airline: 'Ethiopian',
        booking_ref: 'ABC123',
        // A real leg: `normalizeFlight` drops a direction with none, on the
        // grounds that a flight number and two airports is the part worth
        // carrying through an airport.
        outbound: {
          depart_at: '2026-10-01T05:00:00Z',
          depart_tz: 'Asia/Jerusalem',
          legs: [{ flight_no: 'ET404', from: 'TLV', to: 'NRT' }],
        },
      },
    })
    await store.createShoppingItem({ trip_id: 'trip-1', name: 'Kit-Kat', category: 'snacks' })
    await ask('anything')

    expect(calls.specs[0].system).toContain('ABC123')
    expect(calls.specs[0].system).toContain('Kit-Kat')
  })
})

describe('a turn that does not finish cleanly', () => {
  it('says so when it stops at the iteration bound', async () => {
    // The failure the SDK's tool runner produces silently: a paused turn
    // returned as if it were a complete answer (research R2). Here it is a
    // boolean on the wire.
    script([{ text: 'I found some of it', incomplete: true }])
    const res = await ask('Something long')
    expect(events(res.text).at(-1)).toMatchObject({ type: 'done', complete: false })
  })

  it('keeps the partial answer when it fails mid-stream', async () => {
    script([{ text: 'Partly through', error: { code: 'UPSTREAM', message: 'gone' } }])
    const res = await ask('Something')

    // Status is already 200 — headers were flushed with the first event — so the
    // failure travels as an event and the text the traveller was reading stays.
    expect(res.status).toBe(200)
    const types = events(res.text).map((e) => e.type)
    expect(types).toEqual(['text', 'text', 'error'])

    const messages = await storedMessages()
    expect(messages.map((m) => m.content)).toEqual(['Something', 'Partly through'])
  })

  it('leaves the question stored with no answer when nothing came back', async () => {
    script([{ error: { code: 'UPSTREAM', message: 'gone' } }])
    await ask('Unanswered')

    // A question with no answer reads honestly. Losing what was typed would not.
    const messages = await storedMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Unanswered' })
  })

  it('releases the lock after a failure', async () => {
    script([{ error: { code: 'UPSTREAM', message: 'gone' } }])
    await ask('Unanswered')
    expect((await store.getActiveChatThread('trip-1'))?.turn_started_at).toBeNull()
  })
})

describe('a question that is not one', () => {
  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['missing', undefined],
    ['not a string', 42],
  ])('refuses %s with 400 before anything is written', async (_what, content) => {
    const res = await ask(content)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(await storedMessages()).toEqual([])
  })

  it('refuses one that is far too long', async () => {
    const res = await ask('x'.repeat(5000))
    expect(res.status).toBe(400)
  })

  it('leaves no lock behind after a refusal', async () => {
    await ask('')
    const thread = await store.getActiveChatThread('trip-1')
    // Either no thread at all, or one that is not locked. What must not happen
    // is a rejected question holding the conversation shut.
    expect(thread?.turn_started_at ?? null).toBeNull()
  })
})

describe('two people at once', () => {
  it('refuses a second turn while one is running', async () => {
    // Simulated by taking the lock directly: driving two real requests into a
    // race would be timing-dependent and would pass on a fast machine.
    await store.createChatThread('trip-1')
    await store.claimChatTurn('trip-1', new Date().toISOString(), 60_000)

    const res = await ask('Me too')
    expect(res.status).toBe(409)
    // A 409 writes nothing at all: the lock is claimed before the question.
    expect(await storedMessages()).toEqual([])
  })

  it('takes over a lock left behind by a turn that died', async () => {
    await store.createChatThread('trip-1')
    const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    await store.claimChatTurn('trip-1', longAgo, 60_000)

    // Otherwise a serverless function that timed out mid-turn would shut the
    // conversation for both travellers with no way back but a manual reset.
    const res = await ask('Still working?')
    expect(res.status).toBe(200)
  })
})

describe('asking about the world (US2)', () => {
  it('offers the model web search, with a cap on how much it may use', async () => {
    const calls = script([{ text: 'ok' }])
    await ask('Is the Ghibli Museum open on Mondays?')

    // A server-side tool: it runs on the provider's infrastructure and returns
    // results in the same response, so there is nothing of ours to build. What
    // this asserts is that it is offered at all, and bounded.
    expect(calls.specs[0].web_search).toBeDefined()
    expect(calls.specs[0].web_search!.max_uses).toBeGreaterThan(0)
    // Below the iteration bound: the hard stop keeps a turn inside the
    // function's duration limit, this one keeps a question from becoming a
    // research project.
    expect(calls.specs[0].web_search!.max_uses).toBeLessThan(calls.specs[0].max_iterations)
  })

  it('tells the model a fetched page is data, never an instruction', async () => {
    const calls = script([{ text: 'ok' }])
    await ask('anything')
    // FR-014. There is no page in our process to mishandle, so the whole
    // mitigation at this phase lives in how the prompt frames what comes back.
    expect(calls.specs[0].system).toMatch(/never obey|not an instruction/i)
  })

  it('surfaces the searching state to the client', async () => {
    script([{ searching: 'Ghibli Museum opening hours', text: 'Closed Tuesdays.' }])
    const res = await ask('Is it open?')

    const types = events(res.text).map((e) => e.type)
    expect(types[0]).toBe('searching')
    // The query rides along so the screen can say what it is looking up.
    expect(events(res.text)[0]).toMatchObject({ query: 'Ghibli Museum opening hours' })
  })

  it('bounds the turn, and says so rather than pretending it finished', async () => {
    // A turn that keeps searching hits the iteration bound. The failure this
    // guards against is the one the SDK's tool runner produces by default: a
    // paused turn returned as though it were a complete answer (research R2).
    script([{ searching: 'hours', text: 'I found part of it', incomplete: true }])
    const res = await ask('Compare every option')

    expect(events(res.text).at(-1)).toMatchObject({ type: 'done', complete: false })
  })
})
