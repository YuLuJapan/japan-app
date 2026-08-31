// Running a model, and making sure it is paid for.
//
// Every AI capability needs the same two things around it: refuse the call if
// the account is over a cap, and write what it cost to the ledger afterwards.
// Three capabilities are planned (chat 005/006, extraction 007, image
// generation), and three copies of that pairing is how one of them ends up
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
import { modelMeta } from './models.js'
import { runAgent } from './runtime.js'
import type { AgentSpec, AiCapability, AiEvent } from './types.js'

/** Who is charged, and for what. */
export interface MeterSubject {
  /** The account. The cap is per account, so this is never optional. */
  userId: string
  /** Which trip it happened on, where the capability has one. */
  tripId?: string | null
  capability: AiCapability
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
  await assertWithinBudget(store, subject.userId)

  return {
    run: (spec) => meteredRun(store, subject, spec),
  }
}

async function* meteredRun(
  store: DataStore,
  subject: MeterSubject,
  spec: AgentSpec
): AsyncIterable<AiEvent> {
  for await (const event of runAgent(spec)) {
    if (event.type === 'usage') {
      await recordTurn(store, {
        userId: subject.userId,
        tripId: subject.tripId ?? null,
        capability: subject.capability,
        model: spec.model,
        vendor: modelMeta(spec.model).vendor,
        usage: event.usage,
      })
    }
    yield event
  }
}
