// The adapter every test above the vendor boundary runs against.
//
// This is not a convenience. A suite that needs an API key is a suite that
// costs money to run, and a suite that costs money to run stops being run —
// which would take 1123 passing tests with it. `setAiRuntime()` in runtime.ts
// is the seam, the same idiom as `setDataStore` and `setTokenVerifier`.
//
// It is also where the awkward turns live. A real provider produces a paused
// turn, a mid-stream failure and a zero cache read only occasionally and never
// on demand; here they are three lines of a script, so the behaviours that
// matter most — an incomplete answer saying so, a failure keeping its partial
// text — are tested every run rather than hoped for.

import type { AgentSpec, AiEvent, AiRuntime, AiUsage } from '../types.js'

/** What a scripted turn should do. */
export interface FakeTurn {
  /** Emitted as one or more `text` events. */
  text?: string
  /** Emit a `searching` event before the text, as a web-search turn would. */
  searching?: string
  /** Token counts to report. Defaults to a plausible warm turn. */
  usage?: Partial<AiUsage>
  /** End at the iteration bound with more to do (research R2). */
  incomplete?: boolean
  /** Fail part-way, after whatever text was already emitted. */
  error?: { code: string; message: string }
}

const DEFAULT_USAGE: AiUsage = {
  input: 420,
  output: 180,
  cache_write: 0,
  // Non-zero by default because a warm turn is the normal case, and a fixture
  // that reported zero would quietly model the failure SC-008 exists to catch.
  cache_read: 11_840,
}

/** Every spec the fake was asked to run, in order — what assertions read. */
export interface FakeRuntimeCalls {
  specs: AgentSpec[]
}

/**
 * A runtime that replays scripted turns.
 *
 * Turns are consumed in order; once the script runs out the last turn repeats,
 * so a test that sends three messages and only cares about the first does not
 * have to script the other two.
 */
export function createFakeRuntime(script: FakeTurn[] = [{ text: 'A fake answer.' }]): {
  runtime: AiRuntime
  calls: FakeRuntimeCalls
} {
  const calls: FakeRuntimeCalls = { specs: [] }
  let index = 0

  const runtime: AiRuntime = (spec) => {
    calls.specs.push(spec)
    const turn = script[Math.min(index, script.length - 1)] ?? {}
    index += 1
    return replay(turn)
  }

  return { runtime, calls }
}

async function* replay(turn: FakeTurn): AsyncIterable<AiEvent> {
  if (turn.searching !== undefined) {
    yield { type: 'searching', query: turn.searching }
  }

  // Split into two so a test can prove the client appends fragments rather than
  // replacing, and that a mid-stream failure keeps what already arrived.
  if (turn.text) {
    const cut = Math.ceil(turn.text.length / 2)
    yield { type: 'text', text: turn.text.slice(0, cut) }
    yield { type: 'text', text: turn.text.slice(cut) }
  }

  if (turn.error) {
    // No `usage` and no `done`: a turn that died mid-stream reports neither, and
    // the caller has to cope with that rather than assume a tidy ending.
    yield { type: 'error', code: turn.error.code, message: turn.error.message }
    return
  }

  yield { type: 'usage', usage: { ...DEFAULT_USAGE, ...turn.usage } }
  yield { type: 'done', complete: !turn.incomplete }
}
