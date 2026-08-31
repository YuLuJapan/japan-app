// A read-only virtual file system, and the one tool that reads it.
//
// WHY THIS EXISTS
// ---------------
// 005 wrote the whole trip into the system prompt: every place, the day plan,
// the tips, the shopping list, the flight — 8–15K tokens assembled from seven
// datastore reads, on every turn, whether the question was "what time is our
// flight?" or "how long is the train to Hakone?".
//
// Here the prompt carries a *listing* instead, and the model reads a file when
// it needs one. Three things follow, and only one of them is about money:
//
//  - **Latency.** Building the prompt now touches no content at all, so a turn
//    starts on zero queries rather than seven.
//  - **Attention.** A question about a flight is answered against the flight,
//    not against the flight buried in the shopping list.
//  - **Headroom.** Document contents (007) can never live in a prefix that is
//    re-sent every turn. They can live behind a path.
//
// **The money is roughly a wash, and pretending otherwise would be a lie.** A
// cached 12K prefix costs about a fortieth of a cent to re-read; a turn that
// greps twice spends two extra model iterations, which costs more. What is
// bought is the three things above, and a shape that still works when a trip is
// four times this size.
//
// WHAT IS GENERIC AND WHAT IS NOT
// -------------------------------
// Nothing here knows what a trip is. The file table lives in
// `lib/chat-files.ts`; this is the mechanism — the listing, the grep engine, the
// tool. The same split as `src/map/engine.types.ts` against `engine.leaflet.ts`,
// and for the same reason: the interesting half stays testable without the other.

import type { AiTool } from './types.js'

/**
 * One file, built on demand.
 *
 * `build` is called at most once per file system — the caller may read a file
 * twice in one turn, and paying for it twice would put the eager cost back in
 * through a side door.
 */
export interface VirtualFile {
  /** Its address, and what the model names in a tool call. */
  path: string
  /**
   * One line, for the listing.
   *
   * This is the *whole* basis on which the model chooses a file, since the
   * listing carries no sizes (see `manifest`). Say what is in it in the words a
   * question would use — "airline, booking reference, legs and times" beats
   * "flight data".
   */
  description: string
  build(): Promise<string>
}

/** What a `grep` call asked for. Every field is optional; the defaults are a listing-wide search. */
export interface GrepQuery {
  /** One file. Omitted: every file, in listing order. */
  path?: string
  /** A regular expression, case-insensitive. Omitted: read rather than search. */
  pattern?: string
  /** Lines either side of a match. Ignored when there is no pattern. */
  context?: number
  /** First line to return, 1-based. Reads only. */
  offset?: number
  /** How many lines to return. Reads only. */
  limit?: number
}

export interface VirtualFileSystem {
  /** The listing, as it appears in the system prompt. Deterministic. */
  manifest(): string
  /** Answer one query, already formatted for the model. Never throws. */
  grep(query: GrepQuery): Promise<string>
  /** Which paths were actually read this turn, in order, deduplicated. */
  readonly touched: readonly string[]
}

// --- limits ------------------------------------------------------------------
//
// A tool result is billed as input on this turn *and* on every turn after it
// until the conversation scrolls out of the history window, so an unbounded one
// is an unbounded bill. These are the bounds, and every one of them announces
// itself in the output rather than silently cutting.

/** Lines in one result. Roughly 3–4K tokens of JSON at our line lengths. */
const MAX_RESULT_LINES = 300
/** A single line, truncated past this. Also what bounds the regex engine's work. */
const MAX_LINE_CHARS = 400
/** A pattern longer than this is refused rather than compiled. */
const MAX_PATTERN_CHARS = 200
/** Lines either side of a match, when the caller does not say. */
const DEFAULT_CONTEXT = 2
const MAX_CONTEXT = 10

/**
 * Build a file system over a table of files.
 *
 * The table's order is the listing's order and the search order, so it is the
 * one thing a caller controls that the model sees. Put the files a question is
 * most likely to want first.
 */
export function createFileSystem(files: VirtualFile[]): VirtualFileSystem {
  const byPath = new Map(files.map((f) => [f.path, f]))
  const cache = new Map<string, Promise<string>>()
  const touched: string[] = []

  const contentOf = (file: VirtualFile): Promise<string> => {
    if (!touched.includes(file.path)) touched.push(file.path)
    let pending = cache.get(file.path)
    if (!pending) {
      pending = file.build()
      cache.set(file.path, pending)
    }
    return pending
  }

  return {
    manifest: () => renderManifest(files),
    touched,
    async grep(query) {
      try {
        return await answer(query)
      } catch (err) {
        // A tool that throws kills the turn, and the model can neither see why
        // nor try something else. A failure is an answer here: it says what
        // went wrong, and the turn carries on.
        console.error('[vfs] grep failed', err)
        return `Could not read that: ${err instanceof Error ? err.message : 'unknown error'}`
      }
    },
  }

  async function answer(query: GrepQuery): Promise<string> {
    const targets = query.path ? [byPath.get(query.path)] : files
    if (query.path && !targets[0]) {
      return `There is no file at "${query.path}". The files are:\n${files
        .map((f) => `  ${f.path}`)
        .join('\n')}`
    }

    const present = targets.filter((f): f is VirtualFile => !!f)
    if (!query.pattern) {
      // No pattern is a read, not a match-everything search — and a read of
      // every file at once is the eager prompt rebuilt by accident, so it is
      // refused with the one thing that would work instead.
      if (!query.path) return 'Reading needs a path. Give a `path`, or a `pattern` to search for.'
      return readFile(present[0], await contentOf(present[0]), query)
    }

    const regex = compile(query.pattern)
    if (typeof regex === 'string') return regex

    const contents = await Promise.all(present.map(contentOf))
    return searchFiles(present, contents, regex, contextLines(query.context))
  }
}

/**
 * The listing, exactly as the model sees it.
 *
 * **No sizes**, and that is a decision rather than an omission: a size would
 * have to be measured, measuring means building every file, and building every
 * file to write the prompt is the cost this whole mechanism removes. The
 * descriptions are what the model chooses on.
 *
 * Deterministic by construction — a fixed table rendered in its own order,
 * nothing read, nothing sorted, no clock. That matters as much here as it did
 * for the eager prefix: this sits above the cache breakpoint, and a byte that
 * moves re-bills the whole thing while nothing looks wrong.
 */
function renderManifest(files: VirtualFile[]): string {
  const width = Math.max(...files.map((f) => f.path.length))
  const rows = files.map((f) => `  ${f.path.padEnd(width)}  ${f.description}`)
  return rows.join('\n')
}

/** A whole file, or a page of one. */
function readFile(file: VirtualFile, content: string, query: GrepQuery): string {
  const lines = content.split('\n')
  const from = Math.max(1, query.offset ?? 1)
  const limit = Math.min(query.limit ?? MAX_RESULT_LINES, MAX_RESULT_LINES)
  const page = lines.slice(from - 1, from - 1 + limit)

  if (!page.length) {
    return `${file.path} has ${lines.length} lines; there is nothing at line ${from}.`
  }

  const numbered = page.map((line, i) => `${from + i}: ${clip(line)}`)
  const last = from + page.length - 1
  const more =
    last < lines.length
      ? `\n… ${lines.length - last} more lines. Read on with offset ${last + 1}.`
      : ''
  return `${file.path} (lines ${from}-${last} of ${lines.length})\n${numbered.join('\n')}${more}`
}

/** Every match across the given files, grep-style, with context. */
function searchFiles(
  files: VirtualFile[],
  contents: string[],
  regex: RegExp,
  context: number
): string {
  const out: string[] = []
  let matches = 0
  let truncated = false

  for (const [index, file] of files.entries()) {
    const lines = contents[index].split('\n')
    const hits = lines.map((line, i) => (regex.test(clip(line)) ? i : -1)).filter((i) => i >= 0)
    if (!hits.length) continue
    matches += hits.length

    for (const block of blocksOf(hits, lines.length, context)) {
      if (out.length >= MAX_RESULT_LINES) {
        truncated = true
        break
      }
      for (let i = block.from; i <= block.to && out.length < MAX_RESULT_LINES; i += 1) {
        out.push(`${file.path}:${i + 1}: ${clip(lines[i])}`)
      }
      out.push('--')
    }
    if (truncated) break
  }

  if (!matches) {
    const where = files.length === 1 ? files[0].path : 'any file'
    return `No lines in ${where} match that.`
  }

  // The trailing separator is noise on the last block; everything else keeps it
  // so two adjacent blocks do not read as one run of lines.
  if (out.at(-1) === '--') out.pop()
  const note = truncated
    ? `\n… stopped at ${MAX_RESULT_LINES} lines. Narrow the pattern, or read the file with a path.`
    : ''
  return `${matches} matching line${matches === 1 ? '' : 's'}.\n${out.join('\n')}${note}`
}

/** Match line numbers, merged into overlapping context windows. */
function blocksOf(hits: number[], total: number, context: number): { from: number; to: number }[] {
  const blocks: { from: number; to: number }[] = []
  for (const hit of hits) {
    const from = Math.max(0, hit - context)
    const to = Math.min(total - 1, hit + context)
    const last = blocks.at(-1)
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to)
    else blocks.push({ from, to })
  }
  return blocks
}

/**
 * The model's pattern, compiled — or the reason it was not.
 *
 * Two guards, and the second is the one that matters. A pattern is written by a
 * model and could nest quantifiers in a way that backtracks catastrophically,
 * and Node has no way to time a regex out. What bounds it is that every line is
 * clipped to `MAX_LINE_CHARS` before being tested, so the worst case is
 * pathological over a few hundred characters rather than over a whole file.
 */
function compile(pattern: string): RegExp | string {
  if (pattern.length > MAX_PATTERN_CHARS) {
    return `That pattern is too long (limit ${MAX_PATTERN_CHARS} characters). Try a shorter one.`
  }
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return `"${pattern}" is not a valid regular expression. Plain words work as patterns.`
  }
}

const contextLines = (asked: number | undefined): number =>
  Math.min(Math.max(Math.trunc(asked ?? DEFAULT_CONTEXT), 0), MAX_CONTEXT)

const clip = (line: string): string =>
  line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line

// --- the tool ----------------------------------------------------------------

export const GREP_TOOL_NAME = 'grep'

/**
 * The one tool, over one file system.
 *
 * Deliberately one rather than a `read` and a `search`: they differ by whether a
 * pattern was given, and two tools whose descriptions have to explain when to
 * prefer the other is a choice the model gets wrong under load. A write tool
 * later is genuinely a different verb and gets its own.
 *
 * **The schema must not vary per request.** Tool definitions sit above the
 * system block in the cached prefix, so a description that interpolated
 * anything about the trip would invalidate the cache for every turn — the same
 * trap as a clock reading in the prompt, and just as silent.
 */
export function grepTool(fs: VirtualFileSystem): AiTool {
  return {
    name: GREP_TOOL_NAME,
    description: [
      'Search or read the trip files listed in your instructions.',
      '',
      'Give a `pattern` to find matching lines with a little context around each.',
      'Give a `path` with no `pattern` to read that file from the top.',
      'Give both to search inside one file.',
      'With no `path`, every file is searched at once — a good first move when you',
      'do not know where something is kept.',
      '',
      'Results are line-numbered. Long results are cut off and say so; narrow the',
      'pattern, or page through a file with `offset`.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'A file path from the listing, e.g. /trip/flight.json.',
        },
        pattern: {
          type: 'string',
          description:
            'A case-insensitive regular expression. Plain words work. Omit to read instead.',
        },
        context: {
          type: 'integer',
          description: `Lines either side of each match (default ${DEFAULT_CONTEXT}, max ${MAX_CONTEXT}).`,
        },
        offset: { type: 'integer', description: 'Reading only: first line, 1-based.' },
        limit: { type: 'integer', description: 'Reading only: how many lines to return.' },
      },
      additionalProperties: false,
    },
    run: (input) => fs.grep(queryFrom(input)),
  }
}

/**
 * A tool input, read defensively.
 *
 * The model writes this, so nothing about it is guaranteed — a number arriving
 * as a string is routine. Anything unreadable is dropped rather than refused,
 * because a dropped `context` still answers the question and a refusal costs a
 * whole round trip.
 */
function queryFrom(input: unknown): GrepQuery {
  const raw = (input ?? {}) as Record<string, unknown>
  return {
    path: str(raw.path),
    pattern: str(raw.pattern),
    context: num(raw.context),
    offset: num(raw.offset),
    limit: num(raw.limit),
  }
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

function num(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}
