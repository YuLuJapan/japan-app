# Templates

Fill-in-the-blank shapes for the text of each item kind. They are scaffolds, not forms —
drop a section that has nothing true to say in it rather than writing a placeholder. An
empty "Open decisions" heading tells the reader less than no heading at all.

Everything under "Update" is **HTML**. Everything under "Why it matters" is **plain text**.

## Contents

- [Feature — the brief](#feature--the-brief)
- [Foundational item](#foundational-item)
- [User story](#user-story)
- [Bug](#bug)
- [Watch / operational item](#watch--operational-item)
- [Progress update](#progress-update)
- [Screenshot block](#screenshot-block)

## Feature — the brief

**Name** `◆ FEATURE — <short name, the way you would say it out loud>`
**Priority** `Brief` · **Area** `Docs` · **Status** *(empty)*

**Why it matters** — what the traveller gets, the two or three decisions already taken,
and the flag or the phase it sits behind. End with the pointer:

> The destination is free text today: 'Japan', 'japan ', 'Jappan' and 'Tokyo' all save
> equally well — and three features quietly read that one box. Replace it with a country
> dropdown (name + flag), then a city picker scoped to the country chosen, with 'I am not
> sure yet' as a first-class answer rather than an empty field. Cities are zones, so
> choosing them at creation is the same act as starting the journey. Purely additive —
> nothing already on this board changes. Full brief in this item's Updates.

**Update** — the brief itself:

```html
<h2>Full brief — <name></h2><br><br>

<p>Spec <nnn>. <dependency on another spec, or "No dependency on another spec.">
Branch <branch>.</p><br><br>

<h3>The problem</h3><br><br>
<p><what is bad today, with a number in it — "10 of its 12 tip cards are japanOnly",
"0 of 39 places have lat/lng", "about 40 files key on zone_id"></p><br><br>

<h3>The design</h3><br><br>
<p><the one change of meaning or mechanism the whole thing turns on></p><br>
<ul><br>
<li><the evidence in the code that already argued for it — quote the comment, name the file></li><br>
</ul><br><br>

<h3>Rejected: <the tidier answer someone will propose again></h3><br><br>
<p><what it buys, what it costs, why the cost wins></p><br><br>

<h3>The decisions taken rather than assumed</h3><br>
<ul><br>
<li><decision, and the alternative it forecloses></li><br>
</ul><br><br>

<h3>Stories</h3><br>
<ul><br>
<li>FOUNDATIONAL — <what></li><br>
<li>US1 (P1) — <what>. <why it is P1></li><br>
</ul><br>
<p>MVP is <the order>. That is the traveller's actual request: <in one clause>.</p><br><br>

<h3>Constraints inherited from every other spec on this board</h3><br>
<ul><br>
<li><b>Budget.</b> Free tiers only — Vercel Hobby and Supabase Free.</li><br>
<li><b>Offline.</b> The app has to open on a phone with no signal.</li><br>
<li><b>Analytics.</b> A new event is declared in analytics-events.ts first, and no trip content rides as a property.</li><br>
<li><b>Access.</b> Nothing new returns a place, a place id or a file without the same TripView treatment.</li><br>
<li><b>Migration.</b> Committing one is not deploying it — the live project has no migration runner.</li><br>
</ul><br><br>

<h3>Do not lose</h3><br>
<p><what already ships that this must not regress — export field policies, the four
content flags, reminders and push, the terms gate, flag defaults></p><br><br>

<h3>Open decisions</h3><br>
<ul><br>
<li><b><the question?></b> <the two sides, and which way you lean></li><br>
</ul>
```

Trim the inherited-constraints list to the ones this spec can actually break. Reciting all
five where only one applies trains the reader to skip the section.

## Foundational item

**Name** `FOUNDATIONAL · <the thing every story needs>`
**Priority** `Foundational` · **Status** `Not started`

**Why it matters** opens with the caps claim, then the pieces:

> BLOCKS EVERY STORY HERE, AND DEPENDS ON 008 FOR THE COUNTRY CODE. Three pieces.
> (1) A typed CountryFacts record and a registry keyed by ISO code, with a resolver that
> falls back to the free-text match for trips that predate 008 — so this ships before every
> trip has a code. (2) The content-pack seam: SECTIONS, PHRASES, EMERGENCY and
> PACKING_GROUPS move out of the 563-line TripEssentials.tsx into per-country modules.
> (3) Collapse the two definitions of Japan into one: src/lib/destination.ts matches
> japan/nippon/nihon/jp/jpn/日本, while src/pages/Journey.tsx line 28 has its own
> /\bjapan\b/i that also falls back to trip.name.

The caps line is doing real work: it is what stops someone picking up a P1 story first and
discovering the blocker three hours in. Say *why* it blocks rather than only that it does —
"every screen here shows categories, and so does the map in 004. Build them per screen and
four surfaces invent four palettes."

## User story

**Name** `US<n> · <outcome, in the traveller's words>`
**Priority** `P1` / `P2` / `P3` · **Status** `Not started`

**Why it matters**:

```
As a <role>, I want <capability>, so <the reason it is worth building>. INDEPENDENT TEST:
<the steps that prove it, including the access-control case if the story returns a place,
a file, a shopping item or booking metadata>. <One or two sentences: what it depends on,
what it costs, why this priority, what it must not break.>
```

The closing sentence is the one that carries the judgement. Good ones from the board:

- *"Ships alone as the MVP."*
- *"Works on day one — zones already have coordinates."*
- *"Ships with US1 rather than after it: without this the split decays back into a pool within a day, so the two are worthless apart."*
- *"The regression story, and the one that makes the rest safe to do: this is a move, not a rewrite, and a diff of the rendered page should be empty."*
- *"Purely additive — a writer each over an existing payload."*

**Update** (optional, for a story with a design reference or a non-obvious argument):

```html
<h2><the screen or the mechanism></h2><br><br>
<p><what a traveller should feel or get, in one sentence></p><br><br>
<h3><the detail worth a picture></h3><br><br>
<img …><br><br>
<p><i><caption naming what is on the left and what is on the right></i></p><br><br>
<h3>What the screen is made of, top to bottom</h3><br>
<ol><li>…</li></ol><br><br>
<h3>Why <this> and not <that></h3><br><br>
<p>…</p><br><br>
<h3>Independent test</h3><br>
<ol><li>…</li></ol><br><br>
<h3>Notes</h3><br>
<ul><li><b>Depends on</b> …</li><li><b>Ships alone.</b> …</li><li>No new column, no migration, no API change.</li></ul>
```

## Bug

**Name** `BUG · <the symptom, from the user's side>`
**Priority** `P1`–`P3` · **Status** `Not started` · **Area** where the fix lands

**Why it matters** — observed, example, expected, blank-line separated. The example uses
placeholder cities (`city Y`, `city Z`) so the report survives the specific trip it was
found on. Say why the current behaviour is *wrong*, not merely surprising.

**Update** — the diagnosis, which is deliberately not in the column above:

```html
<b>Where it is</b><br>
<the layer — "Client-side only — no API change.">. <files><br><br>

<b>Root cause</b><br>
<the two or three rules that combine to produce it, numbered, each naming the function
and what it was written to do><br><br>

<b>Expected</b><br>
<restated as the rule the fix must satisfy><br><br>

<b>Worth deciding before building</b><br>
• <the smallest fix, and what it costs><br>
• <the question the smallest fix dodges><br>
• <what the existing data forces — "existing rows already carry zone_id = Z, so the fix
has to work on data as it stands — no backfill."><br><br>

<b>Acceptance</b><br>
Given <setup>, <the assertion>. Covered by a test in <where>, alongside <the existing
cases it sits next to>.<br><br>

---<br><i>Generated by <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer">Claude Code</a></i>
```

"Worth deciding before building" is the section that earns a bug item its keep. A bug with
one obvious fix does not need it; a bug where the obvious fix has a side effect does, and
that is the one that comes back if nobody wrote it down.

## Watch / operational item

**Name** `WATCH · <the trap>` (Priority `Watch`) or `SPLIT · <the operation>`
(Priority `Blocker` when it writes to live data with no undo).

**Why it matters** — what goes wrong, the order that avoids it, and what "reversible"
means here:

> The known trap from CLAUDE.md: committing a migration is not deploying it. The live
> Supabase project has no migration runner.
>
> Order is 1) apply 0023_zone_city_key.sql by hand, 2) run npm run split:visits against
> Supabase, dry run first, keep the journal, 3) deploy the app. Reversed, the deployed app
> 500s on its first zone read while every test still passes, because tests use the memory
> store.

For an irreversible operation, open by saying so — *"Everything else is code and is
reversible by deploying again. This writes to live data, once, with no undo."* — then give
the rule it follows, what that rule resolves against the real data, and how it is shipped
(dry run by default, journalled, `--revert`).

## Progress update

Posted on the item the work belongs to, after pushing:

```html
<h2>Implemented — <pushed, not yet merged | merged in PR #N></h2><br><br>
<p>Commit <a href="https://github.com/YuLuJapan/japan-app/commit/<sha>" target="_blank" rel="noopener noreferrer"><short sha></a> on branch <branch>.</p><br><br>

<h3>What landed</h3><br>
<ul><br>
<li><b>FOUNDATIONAL</b> — …</li><br>
<li><b>US1</b> — …</li><br>
</ul><br><br>

<h3><what is deliberately not in this commit></h3><br><br>
<p><and why — "shipping it here would have quietly decided it"></p><br><br>

<h3>Verified</h3><br>
<ul><br>
<li><b>961 tests pass</b> (77 files). Typecheck, lint and the production build all clean.</li><br>
<li><b>Entry chunk unchanged at 233.88 KB gzip</b> — <what that settles></li><br>
<li><b>The export is untouched.</b> <why, by construction rather than by test></li><br>
<li><b>New visibility tests:</b> <the access-control cases></li><br>
</ul><br><br>

<h3>Worth knowing before merging</h3><br>
<ul><br>
<li><the thing a reviewer would otherwise have to discover></li><br>
<li>The open decisions in the brief above are <b>still open</b>: <which></li><br>
</ul><br><br>

<hr><i>Generated by <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer">Claude Code</a></i>
```

The test count, the typecheck and the bundle number are the bar the previous attempt set —
quoting them is how the next person knows this one cleared it.

## Screenshot block

Commit the images to `specs/<nnn>-<slug>/reference/`, push, then embed pinned to the
**full 40-character SHA** of that commit:

```html
<h3>The screens</h3><br><br>

<img src="https://raw.githubusercontent.com/YuLuJapan/japan-app/<40-char-sha>/specs/009-redesign/reference/sheet-trip-and-city.png" width="640" ><br><br>

<p><i>Left to right: 1e collapsed countdown (default) · 1f expanded, one tap in · 1g city
screen. Rendered at real phone width with the design's own fonts, each frame expanded to
full scroll height. Hero photos show as grey placeholders because the design file
references an assets folder that was not shared.</i></p><br><br>

<p>Full resolution:<br>
<a href="https://raw.githubusercontent.com/…/trip-1e-collapsed.png" target="_blank" rel="noopener noreferrer">1e collapsed</a> ·<br>
<a href="https://raw.githubusercontent.com/…/trip-1f-expanded.png" target="_blank" rel="noopener noreferrer">1f expanded</a> ·<br>
<a href="https://raw.githubusercontent.com/…/city-1g.png" target="_blank" rel="noopener noreferrer">1g city</a> ·<br>
<a href="https://raw.githubusercontent.com/…/trip-1a-story-hero.png" target="_blank" rel="noopener noreferrer">1a, not taken</a> ·<br>
<a href="https://github.com/YuLuJapan/japan-app/tree/<branch>/specs/009-redesign/reference" target="_blank" rel="noopener noreferrer">the whole folder</a><br>
</p>
```

One contact sheet at `width="640"` reads on a phone; four full-width screenshots do not.
The caption should say what the reader is comparing and note anything that looks broken but
is not — a grey placeholder photo, a font that is not the final one.
