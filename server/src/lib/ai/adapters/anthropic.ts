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
// and a `zod` dependency. That bet paid: 006 declares a real client tool — the
// `grep` over the trip's virtual files — and it drops into the same loop as one
// more reason to go round again, beside `pause_turn`. Reason (1) is spent;
// reason (2) is not, and would have been a silently truncated answer on any
// turn that both searched and read a file.

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

/**
 * One turn, as a stream of our events.
 *
 * The loop body runs more than once for two reasons and no others: a turn that
 * stopped at `pause_turn` and can be continued, and a turn that asked to use one
 * of our tools. Everything else returns on the first pass. Each round spends one
 * attempt, so neither a web search that keeps finding more to read nor a model
 * that keeps opening files can run away or outlive the function's duration
 * limit.
 */
export async function* runAnthropicTurn(spec: AgentSpec): AsyncIterable<AiEvent> {
  const messages = toProviderMessages(spec.messages)
  const total = emptyUsage()

  for (let attempt = 0; attempt < spec.max_iterations; attempt += 1) {
    const stream = getClient().messages.stream(requestFor(spec, messages))
    yield* ourEventsFrom(stream)

    const message = await stream.finalMessage()
    addUsage(total, message.usage)

    const outcome = outcomeOf(message.stop_reason)
    if (outcome.kind === 'resume') {
      // Hand the partial assistant turn back and go round again — the case the
      // SDK's runner drops.
      messages.push({ role: 'assistant', content: message.content })
      continue
    }

    if (outcome.kind === 'tools') {
      // The model asked to read something. Run every call it made, hand all the
      // results back in one user message — the API requires one `tool_result`
      // per `tool_use`, in the same turn — and go round again.
      messages.push({ role: 'assistant', content: message.content })
      const calls = toolCallsIn(message.content)
      yield* announce(calls)
      messages.push({ role: 'user', content: await runTools(spec, calls) })
      continue
    }

    yield { type: 'usage', usage: total }
    yield outcome.kind === 'refused' ? REFUSAL : { type: 'done', complete: outcome.complete }
    return
  }

  // Fell out of the loop still working: the bound stopped this turn, not the
  // model. Say plainly that the answer is unfinished (FR-013) rather than let a
  // partial answer read as a whole one. This is a likelier ending now than it
  // was in 005 — a turn that reads two files and searches the web has spent four
  // iterations before writing a word — which is why the default bound went up
  // with the tool loop rather than after somebody hit it.
  yield { type: 'usage', usage: total }
  yield { type: 'done', complete: false }
}

// --- client tools -----------------------------------------------------------

/**
 * Run every tool the model called, in the order it called them.
 *
 * Sequential rather than parallel, deliberately. The tools here read a shared
 * memoised file system, so two calls landing together would race to build the
 * same file and the second would win nothing; and a model that asked for three
 * files usually wants the third *because* of the first. The calls are cheap —
 * in-process reads, not network — so ordering costs nothing worth having.
 *
 * **Nothing here throws.** A tool that fails comes back as an error result the
 * model can read and work around; a thrown one would end the turn with no
 * answer and no explanation.
 */
async function runTools(
  spec: AgentSpec,
  calls: Anthropic.ToolUseBlock[]
): Promise<Anthropic.ToolResultBlockParam[]> {
  const byName = new Map((spec.tools ?? []).map((tool) => [tool.name, tool]))
  const results: Anthropic.ToolResultBlockParam[] = []

  for (const call of calls) {
    const tool = byName.get(call.name)
    if (!tool) {
      results.push(errorResult(call, `There is no tool called "${call.name}".`))
      continue
    }
    try {
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: await tool.run(call.input),
      })
    } catch (err) {
      console.error(`[ai] tool ${call.name} threw`, err)
      results.push(errorResult(call, 'That tool failed. Try a different approach.'))
    }
  }

  return results
}

const errorResult = (
  call: Anthropic.ToolUseBlock,
  message: string
): Anthropic.ToolResultBlockParam => ({
  type: 'tool_result',
  tool_use_id: call.id,
  content: message,
  is_error: true,
})

const toolCallsIn = (content: Anthropic.ContentBlock[]): Anthropic.ToolUseBlock[] =>
  content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')

/**
 * Tell the screen a file is being opened.
 *
 * Emitted here rather than from `content_block_start`, where the web-search
 * signal comes from, because a tool call's input arrives as streamed JSON
 * fragments *after* the block starts — at that moment there is a tool call but
 * no path, and "reading something" is a worse line than a slightly later
 * "reading this". The delay is the tail of one message.
 */
function* announce(calls: Anthropic.ToolUseBlock[]): Generator<AiEvent> {
  for (const call of calls) {
    const path = (call.input as { path?: unknown } | null)?.path
    yield { type: 'reading', ...(typeof path === 'string' ? { path } : {}) }
  }
}

// --- what the turn did ------------------------------------------------------

/** Why a turn stopped, in the four shapes the caller acts on. */
type Outcome =
  | { kind: 'resume' }
  | { kind: 'tools' }
  | { kind: 'refused' }
  | { kind: 'finished'; complete: boolean }

/**
 * `stop_reason` → what to do about it.
 *
 * Pure, so the one rule worth getting right is readable on its own:
 * **`max_tokens` is not a complete answer.** It is a truncated one, and is
 * reported as incomplete for the same reason a paused turn is — the traveller
 * has to be able to tell "that's the answer" from "that's where it stopped".
 */
export function outcomeOf(stopReason: Anthropic.Message['stop_reason']): Outcome {
  if (stopReason === 'pause_turn') return { kind: 'resume' }
  if (stopReason === 'tool_use') return { kind: 'tools' }
  if (stopReason === 'refusal') return { kind: 'refused' }
  return { kind: 'finished', complete: stopReason !== 'max_tokens' }
}

const REFUSAL = {
  type: 'error',
  code: 'REFUSED',
  message: 'The model declined to answer that.',
} as const satisfies AiEvent

// --- provider in ------------------------------------------------------------

function toProviderMessages(messages: AgentSpec['messages']): Anthropic.MessageParam[] {
  return messages.map((m) => ({ role: m.role, content: contentOf(m) }))
}

/**
 * Attribution goes into the text rather than into a field, because the API has
 * no place for one: two travellers share a conversation, and without knowing who
 * asked, a follow-up gets answered for the wrong person.
 */
function contentOf(message: AgentSpec['messages'][number]): string {
  return message.role === 'user' && message.author
    ? `${message.author} asked: ${message.content}`
    : message.content
}

function requestFor(spec: AgentSpec, messages: Anthropic.MessageParam[]) {
  return {
    model: providerModelId(spec.model),
    max_tokens: spec.max_output_tokens,
    // Trip Q&A is retrieval, not reasoning. Output is the expensive half of a
    // turn, and low effort is a larger cost lever here than any model swap.
    output_config: { effort: 'low' as const },
    system: [cachedPrefix(spec.system)],
    messages,
    ...toolsFor(spec),
  }
}

/**
 * Every tool the turn may use: ours, then the provider's own.
 *
 * One key or none — the API rejects an empty `tools` array, and 005 ran with no
 * tools at all, so the absence has to stay expressible.
 *
 * **These are cached along with the system prompt.** The cache prefix runs tools
 * → system → messages, and the breakpoint sits on the system block, so every
 * declaration below is inside it. That is free while they are static, and it is
 * why `AiTool` says a description must never mention the trip.
 */
function toolsFor(spec: AgentSpec) {
  const tools = [...clientTools(spec), ...webSearchTools(spec)]
  return tools.length ? { tools } : {}
}

const clientTools = (spec: AgentSpec): Anthropic.ToolUnion[] =>
  (spec.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
  }))

/**
 * The trip, above the cache breakpoint.
 *
 * An hour rather than the 5-minute default, because two people planning across
 * an evening should still be warm after dinner; that difference is roughly
 * threefold on the bill.
 *
 * **Nothing volatile may appear in here.** A clock reading or an unsorted map
 * invalidates the whole prefix and nothing fails — the answers stay correct and
 * only the cost changes (research R5).
 */
function cachedPrefix(system: string): Anthropic.TextBlockParam {
  return {
    type: 'text',
    text: system,
    cache_control: { type: 'ephemeral', ttl: '1h' },
  }
}

/** The provider's own search tool, or nothing. Runs on their infrastructure, not ours. */
function webSearchTools(spec: AgentSpec): Anthropic.ToolUnion[] {
  if (!spec.web_search) return []
  return [
    {
      type: 'web_search_20260209' as const,
      name: 'web_search' as const,
      max_uses: spec.web_search.max_uses,
    },
  ]
}

// --- provider out -----------------------------------------------------------

/** The provider's stream, translated into ours. Everything else is dropped. */
async function* ourEventsFrom(
  stream: AsyncIterable<Anthropic.MessageStreamEvent>
): AsyncIterable<AiEvent> {
  for await (const event of stream) {
    const text = textOf(event)
    if (text !== null) {
      yield { type: 'text', text }
      continue
    }
    if (startsWebSearch(event)) yield { type: 'searching' }
  }
}

/** The text a delta carries, or null when the event is something else. */
function textOf(event: Anthropic.MessageStreamEvent): string | null {
  return event.type === 'content_block_delta' && event.delta.type === 'text_delta'
    ? event.delta.text
    : null
}

/**
 * The model reaching for the web.
 *
 * The query arrives as streamed JSON fragments afterwards, so it is not
 * available yet — and saying "searching" without saying what for is what the
 * screen needs. Waiting for the query would delay the only signal the traveller
 * gets that the turn is doing something slow.
 */
function startsWebSearch(event: Anthropic.MessageStreamEvent): boolean {
  return (
    event.type === 'content_block_start' &&
    event.content_block.type === 'server_tool_use' &&
    event.content_block.name === 'web_search'
  )
}

// --- usage ------------------------------------------------------------------

const emptyUsage = (): AiUsage => ({ input: 0, output: 0, cache_write: 0, cache_read: 0 })

/** Usage accumulates across attempts — a paused turn bills for each leg. */
function addUsage(total: AiUsage, usage: Anthropic.Usage): void {
  total.input += usage.input_tokens ?? 0
  total.output += usage.output_tokens ?? 0
  total.cache_write += usage.cache_creation_input_tokens ?? 0
  total.cache_read += usage.cache_read_input_tokens ?? 0
}
