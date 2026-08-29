# The board, in ids

Everything here was read off the live board. Ids are stable; **label sets are not** —
re-read them with `get_board_info` before a write if it has been a while.

```
board      5103092435   Onward — Next Four
workspace  7466261      Espacio de trabajo principal
item url   https://lkirsmans-team-company.monday.com/boards/5103092435/pulses/<itemId>
```

## Contents

- [Groups](#groups)
- [Columns](#columns)
- [columnValues by column](#columnvalues-by-column)
- [The calls](#the-calls)
- [Gotchas](#gotchas)

## Groups

One per spec, in spec order, with the backlog last. `create_item` without `groupId` drops
the item in the **top** group (`topics` = `003 · Export`), which is almost never what you
want — always pass `groupId`.

| groupId | title |
|---|---|
| `topics` | 003 · Export |
| `group_mm6nsyb4` | 004 · Map |
| `group_mm6ns194` | 005 · Chat (read-only) |
| `group_mm6nv8y2` | 006 · Chat writes |
| `group_mm6ns7v9` | 007 · Import |
| `group_mm6nq60c` | 008 · Destination picker |
| `group_mm6nk1p8` | 009 · Redesign |
| `group_mm6nczme` | 010 · Country configuration |
| `group_mm6pcrvn` | 011 · Repeated cities |
| `group_mm6ny8p6` | Backlog · later specs |

New spec → `create_group` with `groupName: "012 · <Name>"`, `positionRelativeMethod:
"before_at"`, `relativeTo: "group_mm6ny8p6"`, so the backlog stays at the bottom.

## Columns

| id | title | type | notes |
|---|---|---|---|
| `name` | Name | name | carries the prefix |
| `color_mm6na16a` | Status | status | progress only |
| `color_mm6n554y` | Priority | status | kind + rank; column description explains the labels |
| `dropdown_mm6nn59a` | Area | dropdown | multi-select |
| `long_text_mm6nhrax` | Why it matters | long_text | the abstract |
| `board_relation_mm6njk54` | Blocked by | board_relation | self-referencing, multiple allowed |
| `subtasks_mm6ns5ab` | Subitems | subtasks | present but unused — leave alone |

### Status — `color_mm6na16a`

`Not started` · `Working on it` · `Done` · `Stuck`

Left **empty** on `◆ FEATURE` and `SPEC INPUT` items: a brief is not work.

### Priority — `color_mm6n554y`

The column that carries the most meaning on this board. Its own description reads:
*"Blocker = the phase cannot ship without it. Watch = known trap. Minor = polish.
Decision = needs an answer, not code."*

| label | used for |
|---|---|
| `Brief` | `◆ FEATURE` and `SPEC INPUT` items |
| `Foundational` | the one item that blocks every story in its group |
| `P1` | ships alone as the MVP / the whole request |
| `P2` | wanted, follows the MVP |
| `P3` | additive, last |
| `Blocker` | the phase cannot ship without it — used for irreversible live-data operations |
| `Watch` | a known trap, not a task |
| `Decision` | needs an answer, not code |
| `Minor` | polish, backlog |
| `Working on it` `Done` `Stuck` | **template leftovers, never used here** |

### Area — `dropdown_mm6nn59a`

`Frontend` · `Backend` · `Data` · `Design` · `Docs` · `Infra`

Multi-select; reads back comma-joined (`"Frontend, Backend"`). `Docs` is what a
`◆ FEATURE` brief carries. The stored label list contains duplicates (seven `Frontend`,
four `Backend`, two `Design`) created by past `createLabelsIfMissing` calls — see
[Gotchas](#gotchas).

## columnValues by column

`columnValues` is a **JSON string**, not an object — stringify it.

```jsonc
{
  "color_mm6na16a":       { "label": "Not started" },          // status
  "color_mm6n554y":       { "label": "P1" },                    // status
  "dropdown_mm6nn59a":    { "labels": ["Frontend", "Backend"] },// dropdown, multi
  "long_text_mm6nhrax":   "As a traveller, I want …",            // long_text: plain string
  "board_relation_mm6njk54": { "item_ids": [3193345007, 3193345333] }
}
```

Long text is **plain text** — no HTML, no markdown. Newlines survive; use them to separate
a bug's observed / example / expected paragraphs.

`board_relation` replaces the whole set on write. To add one link, read the current
`item_ids` first and send the union.

## The calls

Create one item:

```
create_item
  boardId: 5103092435
  groupId: "group_mm6pcrvn"
  name: "US3 · Move a place to the other visit"
  columnValues: "{\"color_mm6na16a\":{\"label\":\"Not started\"},\"color_mm6n554y\":{\"label\":\"P2\"},\"dropdown_mm6nn59a\":{\"labels\":[\"Backend\"]},\"long_text_mm6nhrax\":\"…\"}"
```

Create a whole spec at once — `create_items`, up to 20, each with its own `groupId`.
Returns an `item_id` and `item_url` per item, or a per-item error; check every one, since
a partial success looks like a success.

Post the brief — `create_update` with `itemId` and an HTML `body`. `parentId` replies to an
existing update. Do not use `@` for mentions; pass `mentionsList`.

Link the dependencies afterwards — `change_item_column_values` (one item) or `update_items`
(up to 40, and it can change `name` too via a `"name"` key).

Read before writing:

```
get_board_info        boardId: 5103092435, filters: {"columns": {"only": true}}
get_board_items_page  boardId: 5103092435, includeColumns: true, limit: 30
                      → paginate with nextCursor; 64 items today, so 3 pages
search                searchType: "ITEMS", boardIds: [5103092435], searchTerm: "…"
get_updates           objectId: "<itemId>", objectType: "Item", includeReplies: true
```

`get_updates` returns `text_body` with links and images stripped. To see an update as it
was written — which you need before editing one, or to copy an image URL — use
`all_api_read`:

```graphql
query ($ids: [ID!]) { updates (ids: $ids) { id item_id body } }
```

## Gotchas

**`createLabelsIfMissing` is how the Area column got seven "Frontend" labels.** Never pass
it on this board. If a write fails because a label is missing, the value is wrong — fix the
value. If a dropdown write ever fails as ambiguous because of the existing duplicates, write
by id instead: `{"ids": [0]}`, with ids from `get_board_info`.

**Status vs Priority.** Both are `status` columns and both still list `Working on it` /
`Done` / `Stuck`. Setting `Done` on `color_mm6n554y` silently makes an item's priority
"Done", which is meaningless and invisible until someone filters by it.

**`groupId` is not optional in practice.** Omit it and the item lands in `003 · Export`.

**The board relation is a set, not an append.** Writing it drops the links you did not send.

**Updates take HTML.** Markdown posts as literal characters. There is no edit-in-place tool
for an update — a correction is a new update (see item `3191954784`, whose second update
opens *"Correction after review"*), or a reply via `parentId`.

**Screenshots are repo-hosted, not monday assets.** No item on this board has ever carried a
monday asset; every image is a `raw.githubusercontent.com` URL pinned to a commit SHA. Keep
it that way — an image that lives only in monday is invisible to anyone reading the spec
folder, and a monday asset URL expires.
