---
name: 'monday-item'
description: 'How to write a feature, a bug, a user story, a foundational item or a backlog note onto the Onward monday.com board, with the right name prefix, column values, Blocked by links, and a full HTML brief in the item Updates including screenshots. Use this skill whenever the user asks to add, file, raise, log, open, write up or update anything on monday — a feature, a spec, a bug, a task, a ticket, a story, a card, an item — or says "put this on the board", "track this in monday", "file a bug for this", "turn this spec into monday items", or asks you to comment on, report progress on, or attach a screenshot to a monday item. Also use it when reading the board to answer questions about it, so the vocabulary of prefixes, priorities and groups is understood correctly.'
compatibility: 'Requires the monday_com MCP server. Screenshots require push access to the YuLuJapan/japan-app repo.'
metadata:
  author: 'Onward'
  board: 'Onward — Next Four (5103092435)'
user-invocable: true
disable-model-invocation: false
---

## What this board is for

`Onward — Next Four` is where a piece of work is argued for before it is built, and
where what was learned building it is written down afterwards. It is not a checklist.
Almost every item on it is readable by someone who was not in the conversation that
produced it, months later, without opening the repo — and that is the property to
preserve, because the two people on this project are also the only two who will ever
read it.

The practical consequence: **a thin item is worse than no item**. "Fix the map bug"
tells the person who picks it up nothing they did not already know. Everything below
is in service of items that carry their own reasoning.

## The board

| | |
|---|---|
| Board | `5103092435` — *Onward — Next Four* |
| Workspace | `7466261` — *Espacio de trabajo principal* |
| Item URL | `https://lkirsmans-team-company.monday.com/boards/5103092435/pulses/<itemId>` |
| Groups | one per spec, `NNN · Name` (`003 · Export` … `011 · Repeated cities`), plus `Backlog · later specs` |

Call `get_board_info` with `filters: {"columns": {"only": true}}` before your first write
in a session. Groups and labels change as specs land, and the ids below are a starting
point, not a promise. Column ids and the exact label sets are in
`reference/board.md` — read it before writing column values.

## The three layers of an item

A spec becomes a group, and a group holds three kinds of item. Match the kind first;
the prefix, the priority and the shape of the text all follow from it.

**`◆ FEATURE — <name>`** · one per group. The brief: why this is worth doing, what was
decided, what was rejected, and what it must not break. Priority `Brief`, Area `Docs`,
**Status left empty** — a brief is not work, so it never says "Not started". Its
"Why it matters" ends with *"Full brief in this item's Updates."* and the actual brief
is the first Update.

**`FOUNDATIONAL · <the thing everything needs>`** · at most one per group. The work that
has to exist before any story can be tested. Priority `Foundational`. Its "Why it matters"
opens with the caps line `BLOCKS EVERY STORY IN THIS SPEC.` (add `, AND DEPENDS ON 008 FOR
THE COUNTRY CODE.` or `, AND SPEC 007 DEPENDS ON IT.` when it reaches across specs), then
enumerates the pieces — usually numbered `(1) (2) (3)`.

**`US<n> · <the outcome, in the traveller's words>`** · the stories. Priority `P1`/`P2`/`P3`.
Named for what the traveller gets, never for the component that changes: *"US1 · See my two
Tokyo stays as two separate cities"*, not *"Split zones by step"*. Each is independently
shippable and independently testable — that is what the numbering means, not sequence.

Then the items that are not stories:

| Prefix | Priority | For |
|---|---|---|
| `BUG · <the symptom, from the user's side>` | `P1`–`P3` | Something is wrong in what shipped |
| `WATCH · <the trap>` | `Watch` | A known way to get this wrong — deploy order, a cascade, a leak |
| `SPLIT · ` / `MIGRATE · ` / other verb | `Blocker` if irreversible | A one-off operation on live data |
| `SPEC INPUT · <topic>` | `Brief` | Constraints gathered for `/speckit-specify`, not work |
| *(no prefix, plain sentence)* | `Minor` or `Watch` | Backlog — goes in `Backlog · later specs` |

`Decision` is the priority for an item that needs an answer rather than code. If a story
carries an unresolved decision inside it instead, open its "Why it matters" with
`OPEN DECISION IN THIS STORY.` and state a recommendation — see US4 of 007 and US2 of 008.

## The three places text goes

Every item has the same three-layer structure, and each layer is written for a different
reader. Getting text into the wrong layer is the most common way an item goes wrong.

**The name** — the promise. Read on a phone in a list of sixty. Uses `·` (middle dot) after
the prefix, `—` (em dash) after `◆ FEATURE`.

**"Why it matters"** (`long_text`) — the abstract, ~40–120 words, and the only thing most
people will read. It must stand alone: someone reading only this column across the whole
board should understand the shape of the work. Never write "see the update below" as its
whole content.

**Updates** — the full brief, in HTML. This is where screenshots, rejected alternatives,
file paths, test counts and commit links live. Long is fine here; the column above is
what keeps the board scannable.

### How to write "Why it matters"

For a **user story**, three moves in one paragraph:

> As a traveller standing in a city, I want to see the places I saved there on a map and
> filter to just food or attractions, so I can decide what is near without leaving the app.
> **INDEPENDENT TEST:** open the map in a zone, confirm pins for that zone's places, and
> that toggling a category shows and hides them. A viewer without `can_see_stays` must
> receive no hotel pins from the server, and see no hotel chip.

1. `As a <role>, I want <capability>, so <the reason it is worth building>.`
2. `INDEPENDENT TEST:` in caps — the steps that prove it, phrased so someone could run
   them without reading the code. Include the access-control case whenever the story
   returns a place, a file, a shopping item or trip-level booking metadata.
3. One or two sentences of consequence: what it depends on, what it costs, why it is
   P1 rather than P3, what it must not break. This is the sentence that stops the item
   being a generic story template — *"Ships alone as the MVP."*, *"Works on day one —
   zones already have coordinates."*, *"Depends on the Permissions-Policy fix in the
   foundational item."*

For a **bug**, four moves, blank-line separated — observed, example, expected, and why
the current behaviour is wrong rather than merely different:

> On a day we move between cities, the day's activities are only visible on the
> destination city's page.
>
> Example: on date X we move from city Y to city Z. Open city Y → the travel day appears
> on the date strip, but its plan is empty. Open city Z → everything is there.
>
> That is backwards for the half of the day you actually spend leaving: the morning in Y
> (checkout, breakfast, the last sight, getting to the station) is planned in Y and should
> be readable from Y's page. Expected: a travel day's itinerary shows under BOTH cities —
> the one we leave and the one we arrive in.

Write the symptom in the traveller's language and the diagnosis in the Updates. A bug
filed as *"belongsToZone filters pinned items"* is a fix looking for a justification;
filed as the sentence above, someone can disagree with the expected behaviour before
anyone writes code.

### Voice

Plain sentences, British spelling, no hype and no hedging. State decisions as decisions
("Decided", "Rejected", "Taken rather than assumed") and open questions as open questions.
Prefer the concrete number to the adjective — *"0 of 39 places have lat/lng"*,
*"10 of its 12 tip cards are japanOnly"*, *"about 40 files key on zone_id"*. Name real
files, functions and migrations (`services/steps.ts`, `resolveZoneId`, `migration 0023`);
they are what makes an item actionable a month later.

## Updates: the brief, in HTML

`create_update` takes **HTML, not markdown** — markdown renders as literal asterisks.
Use `<h2>` `<h3>` `<p>` `<b>` `<i>` `<ul><li>` `<ol><li>` `<hr>` `<img>` `<a>`, and
`<br><br>` between blocks. `reference/templates.md` has ready-to-fill briefs for each
item kind; read it when writing one.

A feature brief runs, in order: **The problem** (what is bad today, with numbers) →
**The design** → **Rejected: `<alternative>`** and why → **decisions taken rather than
assumed** → **Stories** → the constraints inherited from `CLAUDE.md` (budget, offline,
the analytics content rule, flag defaults, access checks, migrations) → **Do not lose**
(what already ships that this must not regress) → **Open decisions**.

The rejected alternative is not padding. Nearly every item on this board that got
revisited was revisited because someone re-proposed the thing that had already been
rejected once.

### Screenshots

Screenshots are **never uploaded to monday**. They are committed into the repo under
`specs/<nnn>-<slug>/reference/` and embedded by raw URL, so the board and the repo
cannot drift apart:

```html
<img src="https://raw.githubusercontent.com/YuLuJapan/japan-app/0a334b2830e8c67bcd388e8dbf47458f5c9c365a/specs/009-redesign/reference/sheet-trip-and-city.png" width="640" >
<br><br>
<p><i>Left to right: 1e collapsed countdown (default) · 1f expanded, one tap in · 1g city
screen. Rendered at real phone width with the design's own fonts.</i></p>
```

Pin the URL to the **full 40-character commit SHA**, never to a branch name — a branch
gets deleted or rebased and every image on the board goes grey. Push the commit before
posting the update, then follow the contact sheet with an italic caption and a
"Full resolution:" line of `<a target="_blank" rel="noopener noreferrer">` links to the
individual files plus the folder.

### Progress updates

When you report implementation back to an item, the shape is: what landed (per story) →
what was deliberately *not* in it → **Verified** (test count, typecheck, lint, build,
bundle size) → **Worth knowing before merging**. Link commits and PRs by full URL. End a
Claude-authored update with the attribution footer, matching the repo's GitHub convention:

```html
<hr><i>Generated by <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer">Claude Code</a></i>
```

## Blocked by

`board_relation_mm6njk54` is self-referencing and means *this cannot start until every
item listed here is Done*. Two patterns are in use, and they are worth following rather
than inventing a third:

- **Within a spec** — a story points at its `FOUNDATIONAL` item, and at any sibling story
  it genuinely needs. Keep it minimal; a story that lists every other story is not
  independently shippable and should be rewritten.
- **Across specs** — every item of the dependent spec points at *every* item of the spec
  it waits on (all of `010`'s items list all six of `008`'s). Coarse on purpose: `010`
  cannot start until `008` exists, and per-item precision there would be false precision.

The relation is set through `columnValues` like any other column — the format is in
`reference/board.md`.

## Writing an item, end to end

1. **Read the board first.** `get_board_info` for the current groups and labels;
   `get_board_items_page` with `includeColumns: true` for the group you are adding to.
   Reuse its wording — a story that sounds unlike its neighbours reads as an import.
2. **Pick the kind**, from the table above. If it is a new spec, create the group
   (`NNN · Name`, next number) and write the `◆ FEATURE` item first: the stories are
   easier to write once the brief exists, and the brief is what tells you whether there
   is a `FOUNDATIONAL` item hiding in them.
3. **Write the name and "Why it matters"**, then create the item with `create_item`
   (or `create_items` for a whole spec at once, up to 20).
4. **Post the brief** as an Update with `create_update`. Push any screenshots to the repo
   first so you can pin the SHA.
5. **Link `Blocked by`** once every item exists — the ids only exist after step 3, so
   this is a `change_item_column_values` pass at the end, not part of creation.
6. **Report back with the item URL**, not just the id. It is the only form anyone can act on.

Check for a duplicate before creating: `search` with `searchType: "ITEMS"` and
`boardIds: [5103092435]`. This board deliberately keeps near-neighbours (a story and the
backlog note that spawned it), so a near-match is not automatically a duplicate — but say
which existing item it sits next to.

## Two things that are easy to get wrong

**Status and Priority are different questions.** Status is progress (`Not started`,
`Working on it`, `Done`, `Stuck`). Priority is *what kind of thing this is and how much it
matters* — `Brief`, `Foundational`, `Blocker`, `Watch`, `Decision`, `Minor`, `P1`/`P2`/`P3`.
Both columns still carry the stock `Working on it`/`Done`/`Stuck` labels in the Priority
list; they are leftovers from the board template and are never used there.

**Never pass `createLabelsIfMissing` on this board.** The Area column already carries seven
labels reading "Frontend" and four reading "Backend" from exactly that mistake. Area is
Frontend / Backend / Data / Design / Docs / Infra and nothing else; if a value you want is
not in that list, that is a signal to reconsider the value, not to create a label.

Subitems are configured on this board but unused. Work that decomposes becomes stories in
the group, not subitems under one — the board's unit of independent shippability is the item.

## Reference

- `reference/board.md` — column ids, exact label sets, `columnValues` JSON for every column
  type on this board, and the API calls with their gotchas. Read before your first write.
- `reference/templates.md` — fill-in-the-blank HTML for a feature brief, a story brief, a
  bug report and a progress update.
