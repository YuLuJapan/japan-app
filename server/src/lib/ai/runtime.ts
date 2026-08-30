// The runtime: resolve a model to its adapter, and hand back a stream of our
// own events.
//
// This is the only module the rest of the server calls. Everything above it
// speaks `AgentSpec` and `AiEvent`; only `adapters/anthropic.ts` has ever seen a
// vendor type, and the ESLint rule in eslint.config.js is what keeps that true
// rather than a comment nobody re-reads.
//
// `setAiRuntime()` is the test seam — the same idiom as `setDataStore` and
// `setTokenVerifier`. It is what lets 1100+ tests run with no key, no network
// and no bill, which is not a convenience: a suite that costs money to run stops
// being run.

import { ApiError } from '../errors.js'
import { modelMeta } from './models.js'
import type { AgentSpec, AiEvent, AiRuntime } from './types.js'

let override: AiRuntime | null = null

/** Test hook: replace the process-wide runtime (pass null to restore the real one). */
export function setAiRuntime(next: AiRuntime | null): void {
  override = next
}

/**
 * Is the AI configured at all?
 *
 * With no key the whole feature is **absent**, not broken — the same shape as
 * push with no VAPID keys and analytics with no PostHog token. Routes answer
 * 404 rather than 500, because a deployment that never set a key has not failed
 * at anything.
 *
 * A runtime installed by a test counts as configured: that is the whole point of
 * the seam, and requiring a fake key alongside it would be ceremony.
 */
export function aiConfigured(): boolean {
  return override !== null || !!process.env.ANTHROPIC_API_KEY
}

/**
 * Run one turn.
 *
 * Deliberately returns an `AsyncIterable` rather than a promise of a whole
 * answer: the events are what the route forwards to the browser as they land, so
 * a slow turn reads as working rather than as stuck (FR-012). Buffering here
 * would put a silence in front of every answer for no gain.
 *
 * Note what this does **not** do: it does not check the budget and it does not
 * write the ledger. Those belong to `services/chat.ts`, which owns the ordering
 * — claim the lock, check the budget, persist the question, run the turn, record
 * what it cost — and can therefore guarantee that ordering. A runtime that
 * quietly did some of it would leave the service unable to reason about the
 * rest.
 */
export function runAgent(spec: AgentSpec): AsyncIterable<AiEvent> {
  if (override) return override(spec)
  return runWithVendor(spec)
}

async function* runWithVendor(spec: AgentSpec): AsyncIterable<AiEvent> {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Routes refuse before reaching here, so this is a guard against a future
    // caller rather than a path anyone should hit. Loudly, because silently
    // returning nothing would look like a model with nothing to say.
    throw new ApiError(404, 'NOT_FOUND', 'Chat is not configured')
  }

  const { vendor } = modelMeta(spec.model)
  if (vendor !== 'anthropic') {
    // Unreachable while the catalogue holds one vendor. It exists so that adding
    // a second vendor is a compile-time prompt to add its adapter here, rather
    // than a runtime surprise about a model that resolves to nothing.
    throw new ApiError(500, 'INTERNAL', `No adapter for vendor "${vendor}"`)
  }

  // Imported lazily so the vendor SDK is not loaded — nor its cost paid — on the
  // many requests to this same serverless function that have nothing to do with
  // chat.
  const { runAnthropicTurn } = await import('./adapters/anthropic.js')
  yield* runAnthropicTurn(spec)
}
