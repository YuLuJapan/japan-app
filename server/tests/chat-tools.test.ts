// A turn that opens a file, end to end — and the vendor translation underneath it.
//
// Two halves, because the boundary in `lib/ai/adapters/` splits them by design:
//
//  - **Above it**, the fake runtime really runs the `AgentSpec.tools` it is
//    handed, so a scripted `grep` exercises the file system, the loaders, the
//    grep engine and the result the model would have read. Only the model's
//    judgement is faked, which is the one part no test can assert on.
//  - **Below it**, `outcomeOf` decides what a `stop_reason` means, and the one
//    that matters is `tool_use` — the reason the loop goes round again rather
//    than presenting a message with no text in it as the answer.

import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { setAiRuntime } from '../src/lib/ai/runtime.js'
import { createFakeRuntime, type FakeTurn } from '../src/lib/ai/adapters/fake.js'
import { outcomeOf } from '../src/lib/ai/adapters/anthropic.js'
import { fixture } from './fixture.js'
import { asOwner, useTestTokens } from './auth.js'

const app = createApp()

let store: DataStore

function script(turns: FakeTurn[]) {
  const { runtime, calls } = createFakeRuntime(turns)
  setAiRuntime(runtime)
  return calls
}

function events(body: string): Record<string, unknown>[] {
  return body
    .split('\n\n')
    .map((frame) => frame.replace(/^data: /, '').trim())
    .filter(Boolean)
    .map((json) => JSON.parse(json) as Record<string, unknown>)
}

const ask = (content: string) =>
  asOwner(request(app).post('/api/trips/trip-1/chat/messages')).send({ content })

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
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

describe('a turn that opens a file', () => {
  it('hands the model the lines it asked for', async () => {
    const calls = script([
      {
        tools: [{ tool: 'grep', input: { path: '/trip/places.json', pattern: 'Ramen' } }],
        text: 'Ramen Bar, in Tokyo.',
      },
    ])
    await ask('Where is the ramen place?')

    expect(calls.toolResults).toHaveLength(1)
    expect(calls.toolResults[0].result).toContain('Ramen Bar')
  })

  it('tells the screen a file is being read, before the answer', async () => {
    // The turn is quiet while a file is being opened, and a quiet turn reads as
    // a broken one. This is the same job `searching` does for the web.
    const calls = script([
      {
        tools: [{ tool: 'grep', input: { path: '/trip/flight.json' } }],
        text: 'You fly at 05:00.',
      },
    ])
    const res = await ask('What time do we fly?')

    const types = events(res.text).map((e) => e.type)
    expect(types).toEqual(['reading', 'text', 'text', 'usage', 'done'])
    expect(events(res.text)[0]).toMatchObject({ type: 'reading', path: '/trip/flight.json' })
    expect(calls.toolResults[0].result).toContain('legs')
  })

  it('answers a search across every file when the model gives no path', async () => {
    const calls = script([
      { tools: [{ tool: 'grep', input: { pattern: 'Suica' } }], text: 'Get a Suica card.' },
    ])
    await ask('Anything about transit cards?')

    expect(calls.toolResults[0].result).toContain('/trip/tips.json:')
  })

  it('carries a tool failure back as text rather than ending the turn', async () => {
    // A tool that throws takes the turn with it and the model can neither see
    // why nor try again. A failure it can read is a failure it can work around.
    const calls = script([
      {
        tools: [{ tool: 'grep', input: { path: '/trip/nope.json' } }],
        text: 'I could not find it.',
      },
    ])
    const res = await ask('Where is that?')

    expect(calls.toolResults[0].result).toContain('There is no file at')
    expect(events(res.text).at(-1)).toMatchObject({ type: 'done', complete: true })
  })

  it('still persists both messages, question first', async () => {
    // The ordering guarantee from 005 is not weakened by a turn that reads: the
    // question is written before the model is called, whether or not it then
    // goes looking through files.
    script([{ tools: [{ tool: 'grep', input: { path: '/trip/tips.json' } }], text: 'Cash only.' }])
    await ask('Anything about the ramen place?')

    const messages = await storedMessages()
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[1].content).toBe('Cash only.')
  })

  it('leaves the trip out of the prefix even on a turn that reads three files', async () => {
    // Reading is not a back door to the eager prefix: what a tool returns is a
    // *message*, below the cache breakpoint, and is gone by the next turn.
    const calls = script([
      {
        tools: [
          { tool: 'grep', input: { path: '/trip/cities.json' } },
          { tool: 'grep', input: { path: '/trip/places.json' } },
          { tool: 'grep', input: { path: '/trip/tips.json' } },
        ],
        text: 'Here is the plan.',
      },
    ])
    await ask('Tell me everything')

    expect(calls.toolResults).toHaveLength(3)
    expect(calls.specs[0].system).not.toContain('Ramen Bar')
  })
})

describe('what a stop reason means', () => {
  // The pure half of the adapter, which is the half worth asserting: the
  // provider's own stream cannot be replayed here, but the decision it drives can.
  it('goes round again for a tool call', () => {
    expect(outcomeOf('tool_use')).toEqual({ kind: 'tools' })
  })

  it('goes round again for a paused turn — the case the SDK runner drops', () => {
    expect(outcomeOf('pause_turn')).toEqual({ kind: 'resume' })
  })

  it('treats a truncated answer as incomplete, not as an answer', () => {
    expect(outcomeOf('max_tokens')).toEqual({ kind: 'finished', complete: false })
    expect(outcomeOf('end_turn')).toEqual({ kind: 'finished', complete: true })
  })

  it('reports a refusal as its own ending', () => {
    expect(outcomeOf('refusal')).toEqual({ kind: 'refused' })
  })
})
