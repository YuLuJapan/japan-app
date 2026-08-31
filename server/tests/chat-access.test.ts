// The chat door: who gets in, and what the app looks like when it is not
// configured at all.
//
// Two refusals, and the order between them matters. `requireTripAccess` runs
// first and answers 404 to anyone who is not a member — so a stranger never
// learns whether this trip has chat, or exists. Only past that door do the
// chat-specific refusals apply.
//
// The "no key" case is the one worth reading twice. With nothing configured
// every chat route answers **404, not 500**: the feature is absent, not broken,
// the same shape push takes with no VAPID keys. A 500 here would turn an
// ordinary un-configured deployment into an error report.

import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { TableMissingError, setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { setAiRuntime } from '../src/lib/ai/runtime.js'
import { createFakeRuntime } from '../src/lib/ai/adapters/fake.js'
import { VIEWER_USER, fixture } from './fixture.js'
import { asOutsider, asOwner, asPartner, asViewer, useTestTokens } from './auth.js'

const app = createApp()

let store: DataStore

/** Puts the friend on trip-1 as a read-only member with everything shared. */
async function addViewer() {
  await store.upsertTripMember({
    trip_id: 'trip-1',
    user_id: VIEWER_USER.id,
    role: 'viewer',
    can_see_stays: true,
    can_see_flight: true,
    can_see_documents: true,
    can_see_shopping: true,
  })
}

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
  // Installing a runtime is what makes the feature "configured" — the same seam
  // the whole suite runs on, so no test ever needs a key or a network.
  setAiRuntime(createFakeRuntime().runtime)
})

afterEach(() => {
  setAiRuntime(null)
})

describe('with no AI configured', () => {
  beforeEach(() => {
    setAiRuntime(null)
    delete process.env.ANTHROPIC_API_KEY
  })

  it('answers 404 to an owner — absent, not broken', async () => {
    const res = await asOwner(request(app).get('/api/trips/trip-1/chat'))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('leaves every other route alone', async () => {
    // The failure this guards against is a chat change that takes the trip down
    // with it. Chat is optional; the trip is not.
    const res = await asOwner(request(app).get('/api/trips/trip-1'))
    expect(res.status).toBe(200)
  })
})

describe('who may open chat', () => {
  it('lets the owner in', async () => {
    const res = await asOwner(request(app).get('/api/trips/trip-1/chat'))
    expect(res.status).toBe(200)
  })

  it('lets a partner in', async () => {
    // trip-2's owner is the fixture's `partner` account; make them a writer here.
    await store.upsertTripMember({
      trip_id: 'trip-1',
      user_id: 'user-sam',
      role: 'partner',
      can_see_stays: true,
      can_see_flight: true,
      can_see_documents: true,
      can_see_shopping: true,
    })
    const res = await asPartner(request(app).get('/api/trips/trip-1/chat'))
    expect(res.status).toBe(200)
  })

  it('refuses a viewer with 403 — they already know the trip exists', async () => {
    await addViewer()
    const res = await asViewer(request(app).get('/api/trips/trip-1/chat'))
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('refuses a viewer even when every visibility flag is on', async () => {
    // Chat is writers-only in *whole*, not merely in its writes. A viewer who
    // can see the stays, the flight, the documents and the shopping list still
    // gets no chat — because one shared thread is only safe among people who all
    // see everything, and a viewer's view can be narrowed at any time.
    await addViewer()
    const res = await asViewer(request(app).get('/api/trips/trip-1/chat'))
    expect(res.status).toBe(403)
  })

  it('answers 404 to an account that is not a member', async () => {
    // Never 403: that would confirm the trip exists to someone with no business
    // knowing it. The trip guard answers before chat is ever consulted.
    const res = await asOutsider(request(app).get('/api/trips/trip-1/chat'))
    expect(res.status).toBe(404)
  })

  it('answers 401 without a token', async () => {
    const res = await request(app).get('/api/trips/trip-1/chat')
    expect(res.status).toBe(401)
  })

  it('answers 404 for a trip that does not exist', async () => {
    const res = await asOwner(request(app).get('/api/trips/trip-nope/chat'))
    expect(res.status).toBe(404)
  })
})

describe('the empty conversation', () => {
  it('reports no thread until somebody asks something', async () => {
    // Null rather than an invented empty thread: the first send creates it, and
    // a read must not write.
    const res = await asOwner(request(app).get('/api/trips/trip-1/chat'))
    expect(res.status).toBe(200)
    expect(res.body.thread).toBeNull()
    expect(res.body.messages).toEqual([])
  })

  it('reports a budget before any spending', async () => {
    const res = await asOwner(request(app).get('/api/trips/trip-1/chat'))
    expect(res.body.budget).toMatchObject({
      spent_cents: 0,
      pct: 0,
      blocked: false,
      resumes_on: null,
    })
    expect(res.body.budget.cap_cents).toBeGreaterThan(0)
  })
})

describe('a route added under /chat', () => {
  it('inherits the guard by construction', async () => {
    // The property worth protecting is that the refusal is mounted on the path,
    // not repeated per handler — so an unknown sub-path is refused for the same
    // reason a known one is, and a route added later cannot forget to check.
    await addViewer()
    const res = await asViewer(request(app).get('/api/trips/trip-1/chat/anything'))
    expect(res.status).toBe(403)
  })
})

describe('when the migration has not been run', () => {
  /** A store whose chat tables are simply not there. */
  function withMissingChatTables() {
    const base = createMemoryStore(fixture())
    const missing = () => {
      throw new TableMissingError('ai_usage', '0023_chat.sql')
    }
    setDataStore({
      ...base,
      getChatThread: missing,
      listChatMessages: missing,
      createChatThread: missing,
      sumAiUsageCents: missing,
    } as DataStore)
  }

  beforeEach(withMissingChatTables)

  it('answers 404 rather than 500 when opening the chat', async () => {
    // This is the failure a committed-but-unapplied migration produces, and
    // "Something went wrong" is a useless thing to read at that moment. 404 is
    // the same "absent, not broken" a missing key gives, and the screen already
    // renders it as "chat isn't set up here".
    const res = await asOwner(request(app).get('/api/trips/trip-1/chat'))
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('answers 404 rather than 500 when sending a message', async () => {
    const res = await asOwner(request(app).post('/api/trips/trip-1/chat/messages')).send({
      content: 'Anything',
    })
    expect(res.status).toBe(404)
  })

  it('leaves the rest of the trip working', async () => {
    // Chat's tables missing must not take the trip down with them.
    expect((await asOwner(request(app).get('/api/trips/trip-1'))).status).toBe(200)
  })
})
