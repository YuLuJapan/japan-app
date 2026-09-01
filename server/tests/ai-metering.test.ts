// The meter: the wrapper that makes a model run impossible without paying for
// it.
//
// Tested directly rather than only through the chat route, because this is the
// seam every future capability will reach for — 007's extraction and the
// backlog's image generation both need exactly this pairing, and a bug here
// would be a capability that quietly runs for free.

import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { setAiRuntime } from '../src/lib/ai/runtime.js'
import { createFakeRuntime } from '../src/lib/ai/adapters/fake.js'
import { openMeter } from '../src/lib/ai/metering.js'
import { monthStart } from '../src/lib/ai/budget.js'
import { DEFAULT_CHAT_MODEL } from '../src/lib/ai/models.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import type { AgentSpec } from '../src/lib/ai/types.js'
import type { DataStore } from '../src/lib/datastore.js'
import { fixture, OWNER_USER, PARTNER_USER } from './fixture.js'

let store: DataStore

const spec: AgentSpec = {
  model: DEFAULT_CHAT_MODEL,
  system: 'the trip',
  messages: [{ role: 'user', content: 'anything' }],
  max_output_tokens: 256,
  max_iterations: 5,
}

const subject = { userId: OWNER_USER.id, tripId: 'trip-1', capability: 'chat' as const }

const spent = () => store.sumAiUsageCents(OWNER_USER.id, monthStart(new Date()))

/** Seeds a priced row, so a cap can be reached without spending anything. */
const seed = (userId: string, cents: number) =>
  store.recordAiUsage({
    user_id: userId,
    trip_id: 'trip-1',
    capability: 'chat',
    vendor: 'anthropic',
    model: DEFAULT_CHAT_MODEL,
    unit: 'tokens',
    quantity: { input: 0, output: 0, cache_write: 0, cache_read: 0 },
    cost_cents: cents,
  })

async function drain(events: AsyncIterable<{ type: string }>) {
  const seen: string[] = []
  for await (const event of events) seen.push(event.type)
  return seen
}

beforeEach(() => {
  store = createMemoryStore(fixture())
  setAiRuntime(createFakeRuntime().runtime)
  process.env.AI_MONTHLY_CAP_CENTS = '1000'
  process.env.AI_GLOBAL_CAP_CENTS = '5000'
})

afterEach(() => {
  setAiRuntime(null)
  delete process.env.AI_MONTHLY_CAP_CENTS
  delete process.env.AI_GLOBAL_CAP_CENTS
})

describe('opening the meter', () => {
  it('is the gate: it throws before anything runs', async () => {
    await seed(OWNER_USER.id, 1000)
    await expect(openMeter(store, subject)).rejects.toMatchObject({ status: 403 })
  })

  it('refuses on the global cap even when the account has room', async () => {
    await seed(PARTNER_USER.id, 5000)
    await expect(openMeter(store, subject)).rejects.toMatchObject({ status: 403 })
  })

  it('charges nothing just by being opened', async () => {
    await openMeter(store, subject)
    // The gate is a read. A meter opened and never run must leave no trace, or
    // an abandoned request would bill for a model that never spoke.
    expect(await spent()).toBe(0)
  })

  it('opens when there is room', async () => {
    await seed(OWNER_USER.id, 500)
    await expect(openMeter(store, subject)).resolves.toBeDefined()
  })
})

describe('running through the meter', () => {
  it('forwards every event unchanged', async () => {
    const meter = await openMeter(store, subject)
    expect(await drain(meter.run(spec))).toEqual(['text', 'text', 'usage', 'done'])
  })

  it('records what the run cost', async () => {
    const meter = await openMeter(store, subject)
    await drain(meter.run(spec))
    expect(await spent()).toBeGreaterThan(0)
  })

  it('records before it forwards the usage event', async () => {
    // The guarantee the whole shape exists for: anything reacting to `usage` —
    // or to the `done` that follows — sees a balance that already includes this
    // run. Asserted mid-stream, because that is the only place it can be wrong.
    const meter = await openMeter(store, subject)
    let atUsage = -1
    for await (const event of meter.run(spec)) {
      if (event.type === 'usage') atUsage = await spent()
    }
    expect(atUsage).toBeGreaterThan(0)
  })

  it('records money and nothing else', async () => {
    // The split this wrapper exists to make: the meter owns the ledger, the
    // service owns the transcript. A meter that also wrote messages would be a
    // second place chat's persistence lived.
    const meter = await openMeter(store, subject)
    await drain(meter.run(spec))

    expect(await spent()).toBeGreaterThan(0)
    // Neither a message nor a thread to hold one: the meter's whole
    // relationship with the transcript is that it does not have one.
    expect(await store.getActiveChatThread('trip-1')).toBeNull()
  })

  it('writes nothing when the run reports no usage', async () => {
    // A turn that died before the model answered costs nothing and must record
    // nothing — a zero row would be noise in a ledger the cap reads.
    setAiRuntime(createFakeRuntime([{ error: { code: 'UPSTREAM', message: 'gone' } }]).runtime)
    const meter = await openMeter(store, subject)
    await drain(meter.run(spec))
    expect(await spent()).toBe(0)
  })

  it('lets a single run cross the cap, and stops the next one', async () => {
    // The limitation stated rather than hidden: usage is known only *after* a
    // run while the gate is *before* it, so one run can cross. What must hold is
    // that it cannot compound — the next `openMeter` sees the recorded row.
    //
    // The run is scripted expensive rather than left on the fixture's default
    // usage, because the default costs a fraction of a cent and whether that
    // crosses a whole-cent boundary depends on the price of whichever model is
    // default — so the assertion used to break every time that changed, saying
    // nothing about the meter.
    setAiRuntime(createFakeRuntime([{ text: 'expensive', usage: { output: 200_000 } }]).runtime)
    await seed(OWNER_USER.id, 999)
    const meter = await openMeter(store, subject)
    await drain(meter.run(spec))

    expect(await spent()).toBeGreaterThan(1000)
    await expect(openMeter(store, subject)).rejects.toMatchObject({ status: 403 })
  })
})
