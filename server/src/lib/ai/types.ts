// The ports. One runtime, a shape per capability — and deliberately no vendor
// type anywhere in this file.
//
// That absence is the point rather than an accident of what 005 happened to
// need. Two things make a vendor choice permanent no matter how good the
// adapter is: what gets written to the database, and what gets sent to the
// browser. Both are declared here, in our own vocabulary, so the adapter is the
// only code that has ever seen an Anthropic type — enforced by the
// `no-restricted-imports` rule in eslint.config.js, the same discipline that
// keeps Leaflet inside src/map/engine.leaflet.ts.
//
// See specs/005-trip-chat/research.md R7 and R8.

/**
 * One message, in the shape we persist and the shape we hand an adapter.
 *
 * `content` is plain text. Storing provider content blocks would put the vendor
 * inside `chat_messages`, where no adapter can reach it — changing provider
 * would become a migration over a live conversation rather than one file.
 */
export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
  /**
   * Display name of whoever wrote it, for a shared thread.
   *
   * The model needs this as much as the screen does: two travellers share one
   * conversation, and without knowing who asked what, a follow-up gets answered
   * for the wrong person.
   */
  author?: string
}

/**
 * What a turn emits, in order. This union is what reaches the browser — never a
 * provider stream event, or a vendor swap would reach into React.
 */
export type AiEvent =
  /** A fragment of the answer. Append it; do not assume sentence boundaries. */
  | { type: 'text'; text: string }
  /** The model is searching the web. `query` is absent when the provider does not say. */
  | { type: 'searching'; query?: string }
  /** What the turn cost. Priced by budget.ts and written to `ai_usage`. */
  | { type: 'usage'; usage: AiUsage }
  /**
   * The turn ended.
   *
   * `complete: false` means it stopped at the iteration bound with more to do,
   * and the screen must say the answer is incomplete rather than present a
   * truncated one as finished. This is exactly the failure the SDK's tool runner
   * produces silently on a paused turn (research R2), so it is made explicit on
   * the wire instead of inferred from the absence of anything.
   */
  | { type: 'done'; complete: boolean }
  /** It failed mid-turn. The client keeps whatever text already arrived. */
  | { type: 'error'; code: string; message: string }

/** Token counts as the provider reported them, before pricing. */
export interface AiUsage {
  input: number
  output: number
  cache_write: number
  /**
   * Tokens served from the cache, at roughly a tenth of input price.
   *
   * **Zero here across repeated turns is a defect, not a number.** It means
   * something is invalidating the cached prefix — a clock reading in the system
   * prompt, an unsorted map, a varying tool list — and the real cost is about
   * threefold the estimate. Nothing else reports it: the answers stay correct
   * and only the bill changes (research R5, SC-008).
   */
  cache_read: number
}

/** A tool the model may call. None are declared in 005 (research R4); 006 adds them. */
export interface AiTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  run: (input: unknown) => Promise<string>
}

/**
 * One request to a model, said without naming a vendor.
 *
 * `system` is the cached half and `messages` the volatile half, and that split
 * is load-bearing: caching is a prefix match, so anything that changes per
 * request must come after the last breakpoint or the whole prefix is
 * re-billed (research R5).
 */
export interface AgentSpec {
  model: import('./models.js').ModelId
  system: string
  messages: AiMessage[]
  /** Client-side tools. Empty in 005. */
  tools?: AiTool[]
  /** Let the model search the web (US2). A server-side tool — nothing to run here. */
  web_search?: { max_uses: number }
  max_output_tokens: number
  /** Hard bound on model iterations. Each web-search pause spends one. */
  max_iterations: number
}

/**
 * The runtime port for a chat-shaped capability.
 *
 * Typed per capability rather than as one generic `call()`: an image generator
 * and a tool-looping chat share no inputs, no outputs and no cost unit, and
 * forcing them through one interface is where these layers usually go wrong.
 * When 007 needs document extraction it adds a port beside this one — it does
 * not widen this one.
 */
export type AiRuntime = (spec: AgentSpec) => AsyncIterable<AiEvent>

// --- the model catalogue's shape --------------------------------------------

export const AI_VENDORS = ['anthropic'] as const
export type AiVendor = (typeof AI_VENDORS)[number]

export const AI_CAPABILITIES = ['chat'] as const
export type AiCapability = (typeof AI_CAPABILITIES)[number]

/**
 * Prices in **cents per million tokens**, so the ledger's arithmetic is integer
 * cents all the way down and nothing depends on a float dollar.
 *
 * All four are required. A model whose cache rates are unknown cannot be costed
 * on a cached prefix, which is the only way this feature is affordable at all —
 * so "we'll fill those in later" is not a state the type allows.
 */
export interface AiPrice {
  input: number
  output: number
  cache_write: number
  cache_read: number
}

export interface ModelMeta {
  vendor: AiVendor
  capability: AiCapability
  context_limit: number
  price: AiPrice
}

/**
 * The catalogue's keys live in models.ts and are derived from the table itself,
 * so a typo is a compile error and a model cannot be referenced without having
 * been priced (FR-028, research R9).
 *
 * Re-exported here so this file remains the one place to read the ports from.
 * The type-only import back to models.ts is circular on paper and free in
 * practice — nothing of it survives compilation.
 */
export type { ModelId } from './models.js'
