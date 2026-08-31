// What the $ai_generation event says, and — mostly — what it does not.
//
// The turn's question and answer are on it deliberately (FR-029a): without them
// a wrong answer can only be counted, never read. The cached prefix is not, and
// that is the assertion this file exists for. The prefix is the whole trip —
// every booking reference and the shopping list — and it is byte-identical on
// every turn, so leaking it would be the same secrets over and over in exchange
// for nothing a look at the trip would not answer.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openMeter } from '../src/lib/ai/metering.js'
import { createFakeRuntime } from '../src/lib/ai/adapters/fake.js'
import { setAiRuntime } from '../src/lib/ai/runtime.js'
import { DEFAULT_CHAT_MODEL } from '../src/lib/ai/models.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { setPostHog } from '../src/lib/posthog.js'
import type { AgentSpec } from '../src/lib/ai/types.js'
import type { DataStore } from '../src/lib/datastore.js'
import { fixture, OWNER_USER } from './fixture.js'

interface Captured {
  event: string
  distinctId: string
  properties: Record<string, unknown>
}

let store: DataStore
let captured: Captured[]

const SECRET_PREFIX = 'THE FLIGHT\nBooking ref AOXIUF\n\nTHE SHOPPING LIST\n- a present'

const specFor = (messages: AgentSpec['messages']): AgentSpec => ({
  model: DEFAULT_CHAT_MODEL,
  system: SECRET_PREFIX,
  messages,
  max_output_tokens: 256,
  max_iterations: 5,
})

const subject = { userId: OWNER_USER.id, tripId: 'trip-1', capability: 'chat' as const }

async function runTurn(spec: AgentSpec) {
  const meter = await openMeter(store, subject)
  for await (const _event of meter.run(spec)) void _event
  return captured.find((c) => c.event === '$ai_generation')
}

beforeEach(() => {
  store = createMemoryStore(fixture())
  captured = []
  setPostHog({ capture: (payload: Captured) => captured.push(payload) } as never)
  process.env.AI_MONTHLY_CAP_CENTS = '1000'
  process.env.AI_GLOBAL_CAP_CENTS = '5000'
})

afterEach(() => {
  setPostHog(undefined)
  setAiRuntime(null)
  delete process.env.AI_MONTHLY_CAP_CENTS
  delete process.env.AI_GLOBAL_CAP_CENTS
})

describe('the generation event', () => {
  it('carries the question and the answer', async () => {
    setAiRuntime(createFakeRuntime([{ text: 'Ramen at 7.' }]).runtime)

    const event = await runTurn(specFor([{ role: 'user', content: 'What is for dinner?' }]))

    expect(event?.properties.$ai_input).toEqual([{ role: 'user', content: 'What is for dinner?' }])
    expect(event?.properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: 'Ramen at 7.' },
    ])
  })

  it('never carries the cached trip prefix', async () => {
    setAiRuntime(createFakeRuntime([{ text: 'Ramen at 7.' }]).runtime)

    const event = await runTurn(specFor([{ role: 'user', content: 'What is for dinner?' }]))

    expect(JSON.stringify(event?.properties)).not.toContain('AOXIUF')
    expect(JSON.stringify(event?.properties)).not.toContain('a present')
  })

  it('reports the new question, not the first one in the history', async () => {
    setAiRuntime(createFakeRuntime([{ text: 'Friday.' }]).runtime)

    const event = await runTurn(
      specFor([
        { role: 'user', content: 'When do we land?' },
        { role: 'assistant', content: 'Thursday the 9th.' },
        { role: 'user', content: 'And what about Hakone?' },
      ])
    )

    expect(event?.properties.$ai_input).toEqual([
      { role: 'user', content: 'And what about Hakone?' },
    ])
  })

  it('says nothing about an answer when the turn died before there was one', async () => {
    setAiRuntime(createFakeRuntime([{ error: { code: 'INTERNAL', message: 'gone' } }]).runtime)

    const event = await runTurn(specFor([{ role: 'user', content: 'What is for dinner?' }]))

    expect(event?.properties).not.toHaveProperty('$ai_output_choices')
    expect(event?.properties.$ai_is_error).toBe(true)
  })

  it('keeps the partial answer when the turn failed part-way through it', async () => {
    setAiRuntime(
      createFakeRuntime([{ text: 'Ramen at ', error: { code: 'INTERNAL', message: 'gone' } }])
        .runtime
    )

    const event = await runTurn(specFor([{ role: 'user', content: 'What is for dinner?' }]))

    expect(event?.properties.$ai_output_choices).toEqual([
      { role: 'assistant', content: 'Ramen at ' },
    ])
  })

  it('still reports the counters, the cost and who spent it', async () => {
    setAiRuntime(
      createFakeRuntime([
        { text: 'Ramen at 7.', usage: { input: 100, output: 50, cache_write: 0, cache_read: 900 } },
      ]).runtime
    )

    const event = await runTurn(specFor([{ role: 'user', content: 'What is for dinner?' }]))

    expect(event?.distinctId).toBe(OWNER_USER.id)
    expect(event?.properties.$ai_input_tokens).toBe(100)
    expect(event?.properties.$ai_output_tokens).toBe(50)
    expect(event?.properties.$ai_cache_read_input_tokens).toBe(900)
    expect(event?.properties.$ai_total_tokens).toBe(1050)
    expect(event?.properties.$ai_stop_reason).toBe('end_turn')
    expect(event?.properties.ai_capability).toBe('chat')
    expect(Number(event?.properties.$ai_total_cost_usd)).toBeGreaterThan(0)
  })

  it('is not sent at all when PostHog is not configured', async () => {
    setPostHog(null)
    setAiRuntime(createFakeRuntime([{ text: 'Ramen at 7.' }]).runtime)

    await runTurn(specFor([{ role: 'user', content: 'What is for dinner?' }]))

    expect(captured).toHaveLength(0)
  })
})
