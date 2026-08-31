// What model to run and how much may be spent, resolved per turn.
//
// Both used to be read straight from the environment, which meant changing
// either was a deploy. They are feature flags now, so the model can be swapped
// and the cap raised or lowered from PostHog while a trip is in progress —
// which is exactly when you find out you picked the wrong one.
//
// THE FALLBACK ORDER IS THE SAFETY PROPERTY
//
//   flag → environment variable → built-in default
//
// PostHog being unreachable, unconfigured, slow, or simply not knowing a key are
// all ordinary states, and every one of them lands on the environment variable —
// which is where the value lived before flags existed. **A flag can only ever
// narrow or redirect within what the code already supports**, never unlock
// something new: an unknown model falls back rather than being passed through,
// and a nonsense cap falls back rather than becoming `NaN`, which would compare
// false against everything and silently disable the cap.

import { monthlyCapCents } from './budget.js'
import { DEFAULT_CHAT_MODEL, isModelId, type ModelId } from './models.js'
import { readServerFlags, type FlagSnapshot } from '../posthog.js'

/** Which model to run. A variant name, or a string payload. */
export const MODEL_FLAG = 'ai-chat-model'
/** The per-account monthly cap, in cents. A number payload. */
export const CAP_FLAG = 'ai-monthly-cap-cents'

export interface AiSettings {
  model: ModelId
  monthlyCapCents: number
}

/**
 * Resolve both settings in one request.
 *
 * One `evaluateFlags` call rather than one per flag, so a turn pays a single
 * round trip for the pair — and the same snapshot answers both, so they cannot
 * come from two different moments.
 */
export async function aiSettings(userId: string): Promise<AiSettings> {
  const flags = await readServerFlags(userId, [MODEL_FLAG, CAP_FLAG])
  return {
    model: modelFrom(flags),
    monthlyCapCents: capFrom(flags),
  }
}

/** The settings as the environment alone would give them — the fallback, named. */
export const defaultAiSettings = (): AiSettings => ({
  model: DEFAULT_CHAT_MODEL,
  monthlyCapCents: monthlyCapCents(),
})

function modelFrom(flags: FlagSnapshot | null): ModelId {
  const named = flags && stringFrom(flags, MODEL_FLAG)
  // `isModelId` is what stops a typo in PostHog from reaching the runtime as a
  // model with no price — which would write 0 to the ledger and stop the cap
  // working. A flag may pick from the catalogue; it may not extend it.
  if (named && isModelId(named)) return named
  if (named) console.error(`[ai] flag ${MODEL_FLAG}="${named}" is not a known model — ignoring`)
  return DEFAULT_CHAT_MODEL
}

function capFrom(flags: FlagSnapshot | null): number {
  const raw = flags?.payload(CAP_FLAG)
  const cents = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  if (Number.isFinite(cents) && cents >= 0) return cents
  if (raw !== undefined)
    console.error(`[ai] flag ${CAP_FLAG}=${String(raw)} is not a cap — ignoring`)
  return monthlyCapCents()
}

/**
 * A flag's value as a string, from either shape PostHog can carry it in.
 *
 * A multivariate flag's variant name is the obvious way to name a model, but a
 * JSON payload is the one that survives a model id with a slash in it — so both
 * are read, variant first.
 */
function stringFrom(flags: FlagSnapshot, key: string): string | null {
  const variant = flags.value(key)
  if (typeof variant === 'string' && variant && variant !== 'true') return variant
  const payload = flags.payload(key)
  return typeof payload === 'string' && payload ? payload : null
}
