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
/**
 * How the trip reaches the model: `lazy` (a listing plus a `grep` tool) or
 * `eager` (the whole trip written into the prefix, as 005 shipped it).
 *
 * **The rollback lever, not a rollout one.** Lazy is the default and is what
 * every deploy runs; this exists so that a model reading badly — answering
 * without opening a file, or opening all seven every turn — can be undone from
 * PostHog while two people are mid-trip, rather than waiting on a deploy.
 * `chat-context.ts` keeps both builders alive for exactly this.
 */
export const CONTEXT_FLAG = 'ai-chat-context'

/** Which prefix a turn is built with. */
export type ContextMode = 'lazy' | 'eager'

export interface AiSettings {
  model: ModelId
  monthlyCapCents: number
  contextMode: ContextMode
}

/**
 * Resolve every setting in one request.
 *
 * One `evaluateFlags` call rather than one per flag, so a turn pays a single
 * round trip for the set — and the same snapshot answers all of them, so they
 * cannot come from two different moments. That matters most for the pair the
 * screen is told about: the cap the gate enforces has to be the cap the composer
 * reported.
 */
export async function aiSettings(userId: string): Promise<AiSettings> {
  const flags = await readServerFlags(userId, [MODEL_FLAG, CAP_FLAG, CONTEXT_FLAG])
  return {
    model: modelFrom(flags),
    monthlyCapCents: capFrom(flags),
    contextMode: contextFrom(flags),
  }
}

/** The settings as the environment alone would give them — the fallback, named. */
export const defaultAiSettings = (): AiSettings => ({
  model: DEFAULT_CHAT_MODEL,
  monthlyCapCents: monthlyCapCents(),
  contextMode: defaultContextMode(),
})

/**
 * Lazy unless the environment says otherwise.
 *
 * Note which way round this is. The other two settings fall back to the value
 * that was *shipped* before they were flags; this one falls back to the new
 * behaviour, because the new behaviour is the feature and the flag is how it is
 * taken back. A deploy with no PostHog — local dev, and any deploy without
 * `VITE_POSTHOG_PROJECT_TOKEN` — therefore gets the lazy prefix, which is what
 * anyone working on this needs to see.
 */
function defaultContextMode(): ContextMode {
  return process.env.AI_CHAT_CONTEXT === 'eager' ? 'eager' : 'lazy'
}

function contextFrom(flags: FlagSnapshot | null): ContextMode {
  const named = flags && stringFrom(flags, CONTEXT_FLAG)
  if (named === 'lazy' || named === 'eager') return named
  if (named) console.error(`[ai] flag ${CONTEXT_FLAG}="${named}" is not a context mode — ignoring`)
  return defaultContextMode()
}

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
