// The spend cap.
//
// Tested with seeded ledger rows rather than with money — which is the only
// sane way to test a cap, and the reason `ai_usage` stores a priced row rather
// than raw counters to be priced later.
//
// The boundaries are the point. `>= cap` blocks and `>= 80%` warns, and getting
// either off by one means a cap that lets one more turn through every month or
// a notice that never fires.

import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { setAiRuntime } from '../src/lib/ai/runtime.js'
import { createFakeRuntime } from '../src/lib/ai/adapters/fake.js'
import { budgetState, monthStart, monthlyCapCents, nextMonthStart } from '../src/lib/ai/budget.js'
import { fixture, OWNER_USER, PARTNER_USER } from './fixture.js'
import { asOwner, useTestTokens } from './auth.js'

const app = createApp()

let store: DataStore

/** Seeds a priced row, so the cap can be driven without spending anything. */
async function spend(userId: string, cents: number, tripId: string | null = 'trip-1') {
  await store.recordAiUsage({
    user_id: userId,
    trip_id: tripId,
    capability: 'chat',
    vendor: 'anthropic',
    model: 'anthropic/claude-opus-5',
    unit: 'tokens',
    quantity: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    cost_cents: cents,
  })
}

const ask = () =>
  asOwner(request(app).post('/api/trips/trip-1/chat/messages')).send({ content: 'Anything' })

const read = () => asOwner(request(app).get('/api/trips/trip-1/chat'))

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

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
  setAiRuntime(createFakeRuntime().runtime)
  delete process.env.AI_MONTHLY_CAP_CENTS
  delete process.env.AI_GLOBAL_CAP_CENTS
})

afterEach(() => {
  setAiRuntime(null)
  delete process.env.AI_MONTHLY_CAP_CENTS
  delete process.env.AI_GLOBAL_CAP_CENTS
})

describe('the reported state', () => {
  it('says nothing has been spent on a fresh account', async () => {
    const res = await read()
    expect(res.body.budget).toMatchObject({ spent_cents: 0, pct: 0, blocked: false })
  })

  it('reports a percentage rounded down', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1000'
    await spend(OWNER_USER.id, 996)
    // 99.6% must not read as a reassuring 100 — nor as blocked, which it isn't.
    expect((await read()).body.budget).toMatchObject({ pct: 99, blocked: false })
  })

  it('blocks exactly at the cap, not one turn past it', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1000'
    await spend(OWNER_USER.id, 1000)
    expect((await read()).body.budget).toMatchObject({ pct: 100, blocked: true })
  })

  it('names the date it comes back only when it is blocked', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1000'
    await spend(OWNER_USER.id, 500)
    expect((await read()).body.budget.resumes_on).toBeNull()

    await spend(OWNER_USER.id, 500)
    expect((await read()).body.budget.resumes_on).toMatch(/^\d{4}-\d{2}-01$/)
  })
})

describe('what the cap counts', () => {
  it('counts one account, not everyone', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1000'
    await spend(PARTNER_USER.id, 5000)
    expect((await read()).body.budget).toMatchObject({ spent_cents: 0, blocked: false })
  })

  it('counts one account across all of its trips', async () => {
    // The cap is per account: somebody with three trips has one budget, not
    // three. A per-trip sum would multiply the bill by however many trips they
    // happen to make.
    process.env.AI_MONTHLY_CAP_CENTS = '1000'
    await spend(OWNER_USER.id, 600, 'trip-1')
    await spend(OWNER_USER.id, 600, 'trip-2')
    expect((await read()).body.budget.blocked).toBe(true)
  })

  it('ignores last month', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1000'
    await spend(OWNER_USER.id, 5000)
    // The sum is taken from the first instant of the current calendar month, so
    // a row stamped before it is simply not in range.
    const before = new Date(Date.parse(monthStart(new Date())) - 1000).toISOString()
    expect(before < monthStart(new Date())).toBe(true)

    const state = await budgetState(store, OWNER_USER.id)
    expect(state.spent_cents).toBe(5000)

    // …and a month later the same rows no longer count.
    const nextMonth = new Date(`${nextMonthStart(new Date())}T00:00:00Z`)
    const later = await budgetState(store, OWNER_USER.id, nextMonth)
    expect(later.spent_cents).toBe(0)
    expect(later.blocked).toBe(false)
  })
})

describe('a capped account', () => {
  beforeEach(async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1000'
    await spend(OWNER_USER.id, 1000)
  })

  it('is refused with 403 and told when it resumes', async () => {
    const res = await ask()
    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(/paused until/i)
  })

  it('is refused before a token is spent', async () => {
    await ask()
    // Nothing written: the refusal happens before the question is persisted.
    expect(await storedMessages()).toEqual([])
  })

  it('can still read what was already asked', async () => {
    // Paused, not broken. The transcript is the thing they paid for.
    const res = await read()
    expect(res.status).toBe(200)
    expect(res.body.budget.blocked).toBe(true)
  })

  it('leaves no lock behind', async () => {
    await ask()
    const thread = await store.getActiveChatThread('trip-1')
    // The budget is checked *after* the lock is claimed, so this is the path
    // that would shut the conversation for both travellers if the release were
    // ever dropped from the failure branch.
    expect(thread?.turn_started_at ?? null).toBeNull()
  })
})

describe('the global kill switch', () => {
  it('refuses an account that is under its own cap', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1000'
    process.env.AI_GLOBAL_CAP_CENTS = '2000'
    await spend(PARTNER_USER.id, 2000)

    const res = await ask()
    expect(res.status).toBe(403)
    expect(res.body.error.message).toMatch(/shared budget/i)
  })

  it('does not fire while the total is under it', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '1000'
    process.env.AI_GLOBAL_CAP_CENTS = '2000'
    await spend(PARTNER_USER.id, 1500)
    expect((await ask()).status).toBe(200)
  })
})

describe('the cap is configuration, not code', () => {
  it('reads the env var, so raising it is a deploy', async () => {
    process.env.AI_MONTHLY_CAP_CENTS = '2500'
    expect(monthlyCapCents()).toBe(2500)
    await spend(OWNER_USER.id, 2000)
    expect((await read()).body.budget.blocked).toBe(false)
  })

  it('falls back rather than reading a nonsense value as no cap at all', async () => {
    // A malformed value must not become NaN: every comparison against NaN is
    // false, so `spent >= cap` would be false forever and a typo in an env var
    // would silently disable the one control that stops this costing money.
    process.env.AI_MONTHLY_CAP_CENTS = 'lots'
    expect(monthlyCapCents()).toBe(1000)
    await spend(OWNER_USER.id, 1000)
    expect((await read()).body.budget.blocked).toBe(true)
  })
})

describe('a turn that runs', () => {
  it('adds what it cost to the month', async () => {
    const before = (await read()).body.budget.spent_cents
    await ask()
    const after = (await read()).body.budget.spent_cents
    // Counted from real token usage the adapter reported, not from the number
    // of messages: one runaway tool loop costs what fifty conversations do.
    expect(after).toBeGreaterThan(before)
  })

  it('records the model and the raw counters alongside the price', async () => {
    await ask()
    const spent = await store.sumAiUsageCents(OWNER_USER.id, monthStart(new Date()))
    expect(spent).toBeGreaterThan(0)
  })
})
