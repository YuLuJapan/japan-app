# 006 — Implementation notes

## Where things live

| file                                      | what it is                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `server/src/lib/ai/vfs.ts`                | the mechanism: `VirtualFile`, the grep engine, the `grep` tool. Knows nothing about trips. |
| `server/src/lib/chat-files.ts`            | the trip's file table and its JSON projections. The only place that knows what a trip is.  |
| `server/src/lib/chat-context.ts`          | both prefixes — `buildLazyContext` (ships) and `buildTripContext` (rollback).              |
| `server/src/services/chat.ts`             | `contextFor`: picks a prefix _and_ its tool list, together.                                |
| `server/src/lib/ai/adapters/anthropic.ts` | the `tool_use` loop, beside the `pause_turn` loop it already had.                          |
| `server/src/lib/ai/settings.ts`           | the `ai-chat-context` flag.                                                                |

The `vfs.ts` / `chat-files.ts` split is the same one as `src/map/engine.types.ts` against
`engine.leaflet.ts`: the interesting half stays testable without the other.

## Decisions

**The listing carries no sizes.** A size has to be measured, measuring means building every
file, and building every file to write the prompt is the cost being removed. The descriptions
are the whole basis on which the model chooses, so they are written in the words a question
would use.

**The front matter stays eager.** Six lines — title, country, dates, travellers, currency —
and it orients every answer. A model that had to open a file to learn which country it is
talking about would spend a round trip on a sentence.

**JSON, pretty-printed, two-space.** Indentation is not cosmetic: the grep engine works in
lines, so a record squashed onto one line returns the whole file for every match, and a
record spread over several gives context lines something to be about.

**One tool, not two.** `read` and `search` differ only by whether a pattern was given, and
two tools whose descriptions must explain when to prefer the other is a choice the model gets
wrong under load. A write tool later is genuinely a different verb.

**A read with no path is refused.** That call is the eager prefix rebuilt through a side
door. It answers with the one thing that would have worked instead.

**`max_iterations` went from 5 to 8.** A turn now spends iterations on reading: open a file,
open a second, search the web, answer — four before anything unusual. The bound still exists
to keep a turn inside the function's duration limit, so it is raised, not removed.

**Tools sit inside the cache prefix.** The order is tools → system → messages, and the
breakpoint is on the system block, so every tool declaration is cached. Free while they are
static — which is why `AiTool` says a description must never mention the trip, and why a test
asserts two turns declare byte-identical tools.

**The flag defaults to the _new_ behaviour.** The other two AI flags fall back to what shipped
before them; this one falls back to lazy, because lazy is the feature and the flag is how it
is taken back. Local dev and any deploy without PostHog therefore get the lazy prefix, which
is what anyone working on this needs to see.

## Testing

`server/tests/chat-vfs.test.ts` — the file system on its own. The first assertion is a **call
count**, not a string: building the listing must touch no content. Then the grep engine
(read, page, search one file, search all, no match, bad pattern, unknown path, the 300-line
cap), what the files contain, and memoisation.

`server/tests/chat-tools.test.ts` — a turn that opens a file, end to end. The fake runtime
**really runs** the `AgentSpec.tools` it is handed, so a scripted `grep` exercises the file
system, the loaders, the grep engine and the result the model would have read. Only the
model's judgement is faked. Below the vendor boundary, `outcomeOf` is asserted directly —
the provider's stream cannot be replayed in a unit test, but the decision it drives can.

`server/tests/chat-turn.test.ts` — the prefix is a listing and a tool; the trip is _absent_
from it (an assertion by absence, plus a length bound); both the prefix and the tool
declaration are byte-identical across turns. 005's own prefix assertions are kept under
`rolling back to the eager prefix`, so the rollback is tested rather than assumed.

`src/tests/chat.test.tsx` — "Reading your trip…" appears while a file is open, and the path
does not.

## Not covered by tests

The provider translation itself — `tool_use` blocks in, `tool_result` blocks out — lives
below the vendor boundary by construction, and the SDK's stream cannot be replayed in a unit
test. Its pure decision (`outcomeOf`) is tested; the block-shuffling around it is not. That
is the same gap 005 accepted for `ourEventsFrom`, and the same mitigation: keep the untested
part small enough to read in one sitting.

## One thing found on the way

`server/tests/ai-metering.test.ts` had been red since the default model changed to Sonnet: it
seeded 999¢ against a 1000¢ cap and expected one run on the fixture's default usage to cross
it, which stopped being true when the price dropped. It now scripts an expensive turn, so the
assertion is about the meter rather than about whichever model happens to be default.
