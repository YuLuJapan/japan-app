// What a model call cost, reported to PostHog's LLM observability.
//
// WHY NOT `@posthog/ai`
// ---------------------
// PostHog ships a wrapper (`@posthog/ai/anthropic`) that subclasses the
// Anthropic client and captures this automatically. Two reasons it is not used:
//
// 1. **It does not support our SDK version.** Every published release up to
//    8.9.0 peers on `@anthropic-ai/sdk@^0.112.3`; we are on 0.122. Installing it
//    anyway means running their subclass against an SDK it was never tested
//    against, and the part that would break is the stream tee — which fails by
//    silently capturing nothing, or worse, by disturbing the stream the
//    traveller is reading.
//
// 2. **It would capture more than we want captured.** Its `$ai_input` is the
//    whole prompt, which here means the entire trip prefix — every booking
//    reference and the shopping list — re-sent on every single turn. What we
//    want is narrower and is spelled out at `$ai_input` below.
//
// Everything else — model, tokens, cost, latency — the meter already has, and
// prices from our own catalogue rather than from a table PostHog maintains. So
// the event is emitted directly, using the property names the wrapper uses so
// the data lands in the same dashboards.

import { randomUUID } from 'node:crypto'
import { getPostHog } from '../posthog.js'
import { modelMeta, providerModelId, type ModelId } from './models.js'
import type { AiCapability, AiUsage } from './types.js'

export interface GenerationReport {
  /** The account, matching the id the browser identifies with. */
  userId: string
  /** One id per turn, so a retry is a separate trace. */
  traceId: string
  capability: AiCapability
  model: ModelId
  usage: AiUsage
  /** What we priced it at, in cents — our catalogue, not PostHog's. */
  costCents: number
  /** Wall clock for the whole turn, in **seconds** (what PostHog expects). */
  latencySeconds: number
  /** `end_turn`, `max_tokens`, `pause_turn`… or null when the turn failed. */
  stopReason: string | null
  isError?: boolean
  /** The question as it was asked. See `$ai_input` below for what this is not. */
  question?: string | null
  /** The answer as it was given, or null when the turn died before one. */
  answer?: string | null
}

export const newTraceId = (): string => randomUUID()

/**
 * Report one generation. Fire-and-forget, and never throws.
 *
 * Telemetry must not be able to fail a turn the traveller already paid for, so
 * every failure here is swallowed after being logged.
 */
export function captureGeneration(report: GenerationReport): void {
  const posthog = getPostHog()
  if (!posthog) return

  try {
    posthog.capture({
      distinctId: report.userId,
      event: '$ai_generation',
      properties: {
        $ai_trace_id: report.traceId,
        $ai_provider: modelMeta(report.model).vendor,
        $ai_model: providerModelId(report.model),
        $ai_input_tokens: report.usage.input,
        $ai_output_tokens: report.usage.output,
        $ai_cache_creation_input_tokens: report.usage.cache_write,
        $ai_cache_read_input_tokens: report.usage.cache_read,
        // Anthropic reports `input_tokens` *excluding* what came from cache, so
        // the cached pools are additional rather than a subset. Saying so stops
        // PostHog double-counting them into the total.
        $ai_cache_reporting_exclusive: true,
        $ai_total_tokens:
          report.usage.input +
          report.usage.output +
          report.usage.cache_write +
          report.usage.cache_read,
        $ai_total_cost_usd: report.costCents / 100,
        $ai_latency: report.latencySeconds,
        $ai_stop_reason: report.stopReason,
        $ai_is_error: report.isError ?? false,
        // The turn itself: what was asked, and what came back. Without these a
        // wrong answer can only be counted, never read, and the trace says a
        // turn happened without saying whether it was any good.
        //
        // NOT the cached prefix, and not the earlier conversation. The prefix is
        // the whole trip — every booking reference and the shopping list — and
        // it is identical on every turn, so sending it would be the same secrets
        // over and over to buy nothing a look at the trip would not answer. The
        // scope is one turn (FR-029a); the client's own analytics stays shapes
        // only (FR-029).
        ...(report.question ? { $ai_input: [{ role: 'user', content: report.question }] } : {}),
        ...(report.answer
          ? { $ai_output_choices: [{ role: 'assistant', content: report.answer }] }
          : {}),
        // Ours, not PostHog's: which capability spent this, so chat, 007's
        // extraction and image generation are separable in one dashboard the
        // way they already are in one ledger.
        ai_capability: report.capability,
      },
    })
  } catch (err) {
    console.error('[ai] could not report a generation', err)
  }
}
