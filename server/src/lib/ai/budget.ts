// The spend cap. The one control that stops this feature costing money.
//
// Three layers, because one is not enough (research R6, and the Monday research
// update's "Actions arising"):
//
//   per account   AI_MONTHLY_CAP_CENTS — a person with three trips has one
//                 budget, not three.
//   global        AI_GLOBAL_CAP_CENTS — so one runaway account cannot become the
//                 whole bill. The brief did not have this.
//   per turn/day  an output ceiling and a turn count. Abuse bounds rather than
//                 budgeting.
//
// Counted on **real token usage** reported by the provider, never on message
// count: one runaway tool loop costs what fifty conversations do, and a
// per-message cap would not notice.
//
// THE LIMITATION, STATED RATHER THAN HIDDEN: usage is only known *after* a turn,
// and the check runs *before* it. So a single turn can cross a cap. That is what
// the per-turn output ceiling bounds — the overshoot is one turn's worth, and it
// cannot compound, because the next check sees the recorded row. Closing it
// entirely would mean a token-counting round trip on every request, buying
// precision nobody needs at a cost everybody pays.

import type { DataStore } from '../datastore.js'
import { forbidden } from '../errors.js'
import { priceUsage, type ModelId } from './models.js'
import type { AiCapability, AiUsage } from './types.js'

/** $10 a month per account, and $50 across everyone, unless the env says otherwise. */
const DEFAULT_MONTHLY_CAP_CENTS = 1000
const DEFAULT_GLOBAL_CAP_CENTS = 5000
const DEFAULT_MAX_OUTPUT_TOKENS = 2048
const DEFAULT_DAILY_TURN_LIMIT = 100
/** Where the quiet notice starts. Below this nothing about money is mentioned. */
export const WARN_AT_PCT = 80

/**
 * Read as an integer, falling back when the value is absent or nonsense.
 *
 * A malformed cap must not read as `NaN`: every comparison against NaN is
 * false, so `spent >= cap` would be false forever and a typo in an env var
 * would silently disable the cap rather than break loudly.
 */
function intFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export const monthlyCapCents = () => intFromEnv('AI_MONTHLY_CAP_CENTS', DEFAULT_MONTHLY_CAP_CENTS)
export const globalCapCents = () => intFromEnv('AI_GLOBAL_CAP_CENTS', DEFAULT_GLOBAL_CAP_CENTS)
export const maxOutputTokens = () => intFromEnv('AI_MAX_OUTPUT_TOKENS', DEFAULT_MAX_OUTPUT_TOKENS)
export const dailyTurnLimit = () => intFromEnv('AI_DAILY_TURN_LIMIT', DEFAULT_DAILY_TURN_LIMIT)

/** The first instant of the calendar month `now` falls in, UTC. */
export function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

/**
 * The first day of *next* month — what a blocked composer says it resumes on.
 *
 * A date rather than an instant: "Chat is paused until 1 October" is what a
 * person needs, and to the hour would be false precision on a boundary they
 * cannot act on anyway.
 */
export function nextMonthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10)
}

/** What the screen renders, computed here so the notice and the enforcement agree. */
export interface BudgetState {
  spent_cents: number
  cap_cents: number
  /** Rounded down, so 99.6% of the cap never reads as a reassuring 100. */
  pct: number
  blocked: boolean
  resumes_on: string | null
}

export async function budgetState(
  store: DataStore,
  userId: string,
  now = new Date(),
  /** The resolved cap. Defaults to the env var, which is the flag's fallback. */
  cap = monthlyCapCents()
): Promise<BudgetState> {
  const spent = await store.sumAiUsageCents(userId, monthStart(now))
  const blocked = spent >= cap
  return {
    spent_cents: spent,
    cap_cents: cap,
    pct: cap > 0 ? Math.min(100, Math.floor((spent / cap) * 100)) : 100,
    blocked,
    resumes_on: blocked ? nextMonthStart(now) : null,
  }
}

/**
 * Refuse a turn that would spend past a cap. Called before the model, never
 * after.
 *
 * Both refusals are 403 with a stated reason: the traveller has done nothing
 * wrong and the app is not broken, so "paused until 1 October" is the honest
 * message rather than a generic failure.
 */
export async function assertWithinBudget(
  store: DataStore,
  userId: string,
  now = new Date(),
  cap = monthlyCapCents()
): Promise<BudgetState> {
  const state = await budgetState(store, userId, now, cap)
  if (state.blocked) {
    throw forbidden(
      `Chat is paused until ${formatResumeDate(state.resumes_on)} — this month's budget is used up`
    )
  }

  // The global check is second because it is the rarer one, and because a
  // person whose own budget is gone should be told about their own budget
  // rather than about everyone else's.
  const total = await store.sumAllAiUsageCents(monthStart(now))
  if (total >= globalCapCents()) {
    throw forbidden(
      `Chat is paused until ${nextMonthStartLabel(now)} — the shared budget is used up`
    )
  }

  return state
}

/**
 * Price a finished turn and append it to the ledger.
 *
 * Priced here, at write time, from the catalogue — never derived on read. A
 * later rate change must not retroactively rewrite what last month cost, and the
 * cap query must not have to know every historical price.
 */
export async function recordTurn(
  store: DataStore,
  args: {
    userId: string
    /** Null for a capability that has no trip — the cap is per account either way. */
    tripId: string | null
    capability: AiCapability
    model: ModelId
    vendor: string
    usage: AiUsage
  }
): Promise<number> {
  const cost = priceUsage(args.model, args.usage)
  await store.recordAiUsage({
    user_id: args.userId,
    trip_id: args.tripId,
    capability: args.capability,
    vendor: args.vendor,
    model: args.model,
    unit: 'tokens',
    // The raw counters ride along beside the price, so a row can be re-checked
    // against the catalogue later — including when a price turns out to have
    // been wrong.
    quantity: { ...args.usage },
    cost_cents: cost,
  })
  return cost
}

/** `2026-10-01` → `1 October`. */
function formatResumeDate(iso: string | null): string {
  if (!iso) return 'next month'
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'next month'
  return `${date.getUTCDate()} ${date.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`
}

const nextMonthStartLabel = (now: Date) => formatResumeDate(nextMonthStart(now))
