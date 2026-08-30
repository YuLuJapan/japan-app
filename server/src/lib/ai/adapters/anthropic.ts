// The Anthropic adapter. THE ONLY MODULE IN THIS REPOSITORY THAT IMPORTS
// `@anthropic-ai/sdk`, enforced by the `no-restricted-imports` rule in
// eslint.config.js — the same discipline that keeps Leaflet inside
// src/map/engine.leaflet.ts, and the thing that makes changing provider one
// file rather than a search across the codebase.
//
// Everything crossing this boundary in either direction is ours: `AgentSpec` in,
// `AiEvent` out. Nothing downstream knows what an Anthropic content block or a
// raw stream event looks like (research R7).
//
// WHY A MANUAL LOOP AND NOT `client.beta.messages.toolRunner`
// -----------------------------------------------------------
// The brief chose the SDK's tool runner. Two reasons it is wrong here, and the
// second is a correctness bug rather than a preference:
//
//  1. 005 declares no client-side tools (research R4), so the runner would be
//     driving an empty set.
//  2. The runner does not auto-resume `stop_reason: 'pause_turn'`. A long
//     web-search turn ends exactly that way, and the runner only continues after
//     a *client* tool returns a result — so a paused turn ends the loop and
//     comes back as the final message with no error and no warning. A silently
//     truncated answer, presented as a complete one. That is the failure FR-013
//     exists to prevent, arriving by default.
//
// Handling it explicitly costs about thirty lines and drops both a beta surface
// and a `zod` dependency. `AgentSpec` still carries tools, so 006 adds client
// tools without reshaping anything.

import Anthropic from '@anthropic-ai/sdk'
import { providerModelId } from '../models.js'
import type { AgentSpec, AiEvent, AiUsage } from '../types.js'

let client: Anthropic | null = null

function getClient(): Anthropic {
  // One client per process. Vercel keeps a function warm between requests, so
  // rebuilding it per turn would throw away connection reuse for nothing.
  client ??= new Anthropic()
  return client
}

const emptyUsage = (): AiUsage => ({ input: 0, output: 0, cache_write: 0, cache_read: 0 })

/**
 * One turn, as a stream of our events.
 *
 * The loop exists for server-side tools: web search runs on Anthropic's
 * infrastructure and a turn using it can stop at `pause_turn` with more to do,
 * which is resumed by handing the paused assistant turn back. Every iteration —
 * including a resume — spends one of `max_iterations`, so a search that keeps
 * finding more to read cannot run away.
 */
export async function* runAnthropicTurn(spec: AgentSpec): AsyncIterable<AiEvent> {
  const anthropic = getClient()
  const total = emptyUsage()

  const messages: Anthropic.MessageParam[] = spec.messages.map((m) => ({
    role: m.role,
    // Attribution goes into the text rather than into a field the API has no
    // place for: two travellers share one conversation, and without knowing who
    // asked what, a follow-up gets answered for the wrong person.
    content: m.role === 'user' && m.author ? `${m.author} asked: ${m.content}` : m.content,
  }))

  const tools = spec.web_search
    ? [
        {
          type: 'web_search_20260209' as const,
          name: 'web_search' as const,
          max_uses: spec.web_search.max_uses,
        },
      ]
    : undefined

  let complete = false

  for (let iteration = 0; iteration < spec.max_iterations; iteration += 1) {
    const stream = anthropic.messages.stream({
      model: providerModelId(spec.model),
      max_tokens: spec.max_output_tokens,
      // Trip Q&A is retrieval, not reasoning. Output is the expensive half of a
      // turn, and low effort is a larger cost lever here than any model swap.
      output_config: { effort: 'low' },
      system: [
        {
          type: 'text',
          text: spec.system,
          // The breakpoint. Everything before it is the trip — 8–15K tokens,
          // identical turn to turn — and is billed at a tenth of input price on
          // a hit. An hour rather than the 5-minute default because two people
          // planning across an evening should still be warm after dinner; that
          // difference is roughly threefold on the bill.
          //
          // Nothing volatile may appear above this line. A clock reading or an
          // unsorted map here invalidates the whole prefix and nothing fails —
          // the answers stay correct and only the cost changes (research R5).
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      messages,
      ...(tools ? { tools } : {}),
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text }
      } else if (
        event.type === 'content_block_start' &&
        event.content_block.type === 'server_tool_use' &&
        event.content_block.name === 'web_search'
      ) {
        // The query arrives as streamed JSON fragments afterwards, so it is not
        // available yet. Saying "searching" without saying what for is honest
        // and is what the screen needs; waiting for the query would delay the
        // only signal the traveller gets that the turn is doing something slow.
        yield { type: 'searching' }
      }
    }

    const message = await stream.finalMessage()
    addUsage(total, message.usage)

    if (message.stop_reason === 'pause_turn') {
      // The turn ran long and can be continued. Hand the partial assistant turn
      // back and go round again — this is the case the SDK's runner drops.
      messages.push({ role: 'assistant', content: message.content })
      continue
    }

    if (message.stop_reason === 'refusal') {
      yield { type: 'usage', usage: total }
      yield {
        type: 'error',
        code: 'REFUSED',
        message: 'The model declined to answer that.',
      }
      return
    }

    // `end_turn`, `max_tokens`, `stop_sequence` — all of them mean this turn is
    // over. `max_tokens` is a truncated answer rather than a paused one, and is
    // reported as incomplete for the same reason a paused turn is.
    complete = message.stop_reason !== 'max_tokens'
    yield { type: 'usage', usage: total }
    yield { type: 'done', complete }
    return
  }

  // Fell out of the loop still paused: the iteration bound stopped it, not the
  // model. Report what it cost and say plainly that the answer is unfinished
  // (FR-013) rather than let a partial answer read as a whole one.
  yield { type: 'usage', usage: total }
  yield { type: 'done', complete: false }
}

/** Usage accumulates across iterations — a paused turn bills for each leg. */
function addUsage(total: AiUsage, usage: Anthropic.Usage): void {
  total.input += usage.input_tokens ?? 0
  total.output += usage.output_tokens ?? 0
  total.cache_write += usage.cache_creation_input_tokens ?? 0
  total.cache_read += usage.cache_read_input_tokens ?? 0
}
