# 006 — The trip as files the model opens

**Status:** implemented
**Depends on:** 005 (trip chat)
**Flag:** `ai-chat-context` (`lazy` | `eager`), server-side, default `lazy`

## The problem

005 put the whole trip in the system prompt. Every turn:

1. runs seven datastore reads (`loadSnapshot`) before the model is asked anything,
2. renders every place, the day plan, every tip, the shopping list, the flight and every
   document name into 8–15K tokens of prefix,
3. sends that prefix whether the question was "what time is our flight?" or "how far is
   Hakone?".

It works, and it is affordable, because the prefix is cached. What it is not is a shape that
survives what comes next. Three things break it:

- **Document contents (007).** A PDF's text cannot go in a prefix that is re-sent every turn.
- **Size.** The prefix is linear in the trip. A trip three times this one is a prefix three
  times this one, and the cost of a _cold_ turn — the first of an evening, after the cache
  has expired — grows with it.
- **Writes.** A model that can change the trip needs an addressable surface to change. A wall
  of prose is not one.

And one thing that is true today: the model reads the shopping list to answer a question
about a train.

## What this builds

A read-only virtual file system over the trip. The prefix carries a **listing**; the model
opens a file when a question needs one.

```
/trip/cities.json      the cities of the trip in journey order, and the dates in each
/trip/flight.json      airline, booking reference, legs, departure and arrival times
/trip/places.json      every saved place — stays, sights, food and shops
/trip/itinerary.json   the day plan: what happens on which day, in which city
/trip/tips.json        notes saved against a place, a city, or the trip as a whole
/trip/shopping.json    the shopping list: what to buy, where, what is bought already
/trip/documents.json   the names of documents saved on the trip
```

One tool reads them:

| call                            | means                                          |
| ------------------------------- | ---------------------------------------------- |
| `grep({ pattern })`             | search every file, matching lines with context |
| `grep({ path })`                | read that file from the top                    |
| `grep({ path, pattern })`       | search inside one file                         |
| `grep({ path, offset, limit })` | page through a long file                       |

## Requirements

- **FR-101** The system prefix contains the trip's front matter (title, country, dates,
  travellers, currency, description) and the listing. It contains no place, no plan entry, no
  tip, no shopping item, no document name and no flight detail.
- **FR-102** Building the prefix performs **no content reads**. The trip row is already held
  by `requireTripAccess`.
- **FR-103** A file is built at most once per turn, however many times it is read.
- **FR-104** Only files the model actually opens are built. A turn that opens none reads
  nothing.
- **FR-105** The prefix is byte-identical across turns for an unchanged trip, and so is the
  tool declaration — both sit above the cache breakpoint.
- **FR-106** A tool call never throws. An unknown path, a bad pattern, a read past the end
  and a failure all come back as text the model can act on.
- **FR-107** A tool result is bounded (300 lines, 400 characters per line) and says when it
  was cut, with the way to narrow it.
- **FR-108** The files contain exactly what the eager prefix contained: everything a writer
  can see, document names only. This feature moves _when_ the model sees something, never
  _whether_ it may.
- **FR-109** A turn that opens a file tells the screen so (`reading` event), because a quiet
  turn reads as a broken one.
- **FR-110** `ai-chat-context=eager` restores 005's behaviour exactly, tools included (none).

## Non-goals

- **Writing.** Files are read-only and the prompt says so. See "What comes next".
- **Persistence of file contents.** A file is projected from the datastore on read; nothing
  is stored.
- **Ids in files.** They are noise to read, they are the bulkiest field in a row, and nothing
  the model can do with one exists yet. This is the first decision to revisit for writes.

## What this is and is not worth

Stated plainly, because the obvious claim is the wrong one.

**It is not mainly a cost saving.** A cached 12K prefix re-reads for roughly 0.024¢ at
Sonnet's rates. A turn that opens two files spends two extra model iterations, each re-sending
the conversation — that costs _more_ than the prefix it replaced. What genuinely gets cheaper
is the **cold** turn, the first of an evening, which pays cache-write on the whole trip today.

**What it buys:**

- **Latency.** No seven-query fan-out before the first token.
- **Attention.** A flight question is answered against the flight.
- **Headroom.** 007's documents, and a trip four times this size, have somewhere to live.
- **A surface.** Writes need an address. This is the address.

**What it risks**, and what watches each:

| risk                                   | what it looks like        | what watches it                          |
| -------------------------------------- | ------------------------- | ---------------------------------------- |
| The model answers without reading      | confident wrong answers   | `files_read: 0` on `chat_turn_completed` |
| The model reads everything, every turn | slow turns, higher bills  | `files_read: 7`                          |
| A turn runs out of iterations          | "that's where it stopped" | `outcome: 'capped'`                      |

All three are recoverable in one flag flip, which is why `ai-chat-context` exists and why
`buildTripContext` was kept rather than deleted.

## What comes next

**Writing, and the post-persist hook.** The shape this is built towards:

1. A file declares itself writable and supplies a parser: text in, a typed patch out.
2. A `write` (or `edit`) tool takes a path and the new content, parses it, and hands the
   patch to the _service_ — never to the datastore. Validation, permissions and the
   collect-all-errors convention are already there and must stay the only route in.
3. The service persists, and the file system drops its memo for that path so a re-read in
   the same turn sees the change.
4. A post-persist step reports what changed on the wire (an `edited` event beside `reading`),
   so the screen can refetch the affected query rather than the whole trip.

Two things are deliberately not stubbed for it: ids in the file projections, and a `write`
member on `VirtualFile`. Both are decisions that want to be made against a real write tool,
not guessed at now.
