// Running a model, and making sure it is paid for and accounted for.
//
// Every AI capability needs the same three things around it: refuse the call if
// the account is over a cap, write what it cost to the ledger, and report it to
// observability. Three capabilities are planned (chat 005/006, extraction 007,
// image generation), and three copies of that is how one of them ends up
// missing the cap — the one control this whole area exists to keep.
//
// WHY TWO PHASES AND NOT ONE WRAPPER
// ----------------------------------
// The obvious shape is `runBilled(spec)`: check, run, record. It is wrong here,
// and a test says so. The check has to happen before the *caller's* own writes —
// chat persists the question before calling the model, so that a turn which dies
// leaves a readable conversation rather than losing what was typed. Fold the
// check into the run and a capped account gets its question stored and then
// refused, leaving a question nobody will ever answer in the transcript.
//
// So: opening the meter is the gate, and running through it is the record. The
// caller keeps whatever ordering it needs in between, and the type says a run
// cannot happen without having passed the gate first.

import type { DataStore } from '../datastore.js'
import { assertWithinBudget, recordTurn } from './budget.js'
import { modelMeta, priceUsage } from './models.js'
import { captureGeneration, newTraceId } from './observability.js'
import { runAgent } from './runtime.js'
import type { AgentSpec, AiCapability, AiEvent, AiUsage } from './types.js'

/** Who is charged, and for what. */
export interface MeterSubject {
  /** The account. The cap is per account, so this is never optional. */
  userId: string
  /** Which trip it happened on, where the capability has one. */
  tripId?: string | null
  capability: AiCapability
  /**
   * The cap to enforce, in cents. Omit to use the environment's.
   *
   * Passed in rather than read here because it is a feature flag now
   * (`lib/ai/settings.ts`), and the value the gate enforces must be the same one
   * the screen was told about — resolved once per turn, not twice.
   */
  capCents?: number
}

export interface Meter {
  /**
   * Run a spec, recording what it costs as the usage arrives.
   *
   * The ledger write completes **before** the `usage` event is forwarded, so
   * anything reacting to that event — or to the `done` that follows it — sees a
   * balance that already includes this run.
   */
  run(spec: AgentSpec): AsyncIterable<AiEvent>
}

/**
 * Open a meter, refusing the caller if they are already over a cap.
 *
 * Throws the same 403 `ApiError` the budget check has always thrown, so callers
 * that already handle it need no change. Nothing has run and nothing has been
 * charged when it throws.
 */
export async function openMeter(store: DataStore, subject: MeterSubject): Promise<Meter> {
  await assertWithinBudget(store, subject.userId, new Date(), subject.capCents)

  return {
    run: (spec) => meteredRun(store, subject, spec),
  }
}

async function* meteredRun(
  store: DataStore,
  subject: MeterSubject,
  spec: AgentSpec
): AsyncIterable<AiEvent> {
  const started = Date.now()
  const traceId = newTraceId()
  let usage: AiUsage | null = null

  for await (const event of runAgent(spec)) {
    if (event.type === 'usage') {
      usage = event.usage
      await recordTurn(store, {
        userId: subject.userId,
        tripId: subject.tripId ?? null,
        capability: subject.capability,
        model: spec.model,
        vendor: modelMeta(spec.model).vendor,
        usage: event.usage,
      })
    }

    // Reported once the turn has resolved, so the event carries how it ended
    // rather than being sent optimistically the moment usage arrived.
    if (event.type === 'done' || event.type === 'error') {
      report(subject, spec, {
        traceId,
        usage,
        started,
        stopReason: event.type === 'done' ? (event.complete ? 'end_turn' : 'max_iterations') : null,
        isError: event.type === 'error',
      })
    }

    yield event
  }
}

function report(
  subject: MeterSubject,
  spec: AgentSpec,
  turn: {
    traceId: string
    usage: AiUsage | null
    started: number
    stopReason: string | null
    isError: boolean
  }
): void {
  // A turn that died before the model answered has nothing to report but the
  // failure itself; zeroes are the honest counters for it.
  const usage = turn.usage ?? { input: 0, output: 0, cache_write: 0, cache_read: 0 }
  captureGeneration({
    userId: subject.userId,
    traceId: turn.traceId,
    capability: subject.capability,
    model: spec.model,
    usage,
    costCents: priceUsage(spec.model, usage),
    latencySeconds: (Date.now() - turn.started) / 1000,
    stopReason: turn.stopReason,
    isError: turn.isError,
  })
}
