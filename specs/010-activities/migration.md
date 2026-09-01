# 010 — Migration: two tables into one, without losing a row

**Read this before running anything.** The Supabase project is live, has no migration runner,
and holds 109 trips. Committing a `supabase/migrations/*.sql` file does nothing until someone
runs it against the project.

The governing rule is **expand → cut over → contract**. `places` and `itinerary_items` are
never dropped in the same release that stops reading them, so for the whole soak the old rows
are still sitting there, verbatim, as their own backup.

## 1 · What is in production today

Measured on `qttchtarjckoollcvexi` at **2026-09-01 20:08 UTC**. **The database is live and
these moved while this document was being written** — `itinerary_items` went 224 → 226 in the
course of an afternoon. Treat every number as a shape, not a constant: the migration's own
pre-flight and verification queries (§5, §6) are what must be believed on the day.

|                                                        |                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `places`                                               | 56 — 39 never scheduled, 11 stays, 13 located                                       |
| `itinerary_items`                                      | 226 — 179 free text, 24 linked to a place, 23 highlights, 91 tagged, 5 with no city |
| places scheduled more than once                        | 5                                                                                   |
| **folds** (non-stay places with ≥ 1 linked item)       | **16**                                                                              |
| **copies** (their 2nd and later days)                  | **7**                                                                               |
| items hanging off a stay (never folded)                | 1                                                                                   |
| linked items whose title differs from the place's name | 15                                                                                  |
| plan lines already tagged `hotel`                      | 43                                                                                  |
| `files.place_id` set                                   | 6                                                                                   |
| `tips.place_id` set                                    | 7                                                                                   |
| id collisions between the two tables                   | **0**                                                                               |
| places whose zone has no trip                          | **0**                                                                               |

The last two are pre-flight assertions, not observations — the migration re-checks them and
aborts rather than trusting this table.

## 2 · The shape: evolve, don't copy

`itinerary_items` **becomes** `activities`. It is not copied into a new table, because an
activity is what an itinerary item already was — 226 of the 282 rows are the right shape
already, and the 56 places are the small side of the merge. A place gains a schedule it
usually leaves empty; an item gains the four things only a place could carry.

```
alter table itinerary_items rename to activities;
      rename title → name, note → description
      day: drop not null                     -- an activity need not be scheduled
      category: widen the check to allow 'other'   -- places can be, the plan could not
      add name_ja, address, image_url, links, lat, lng
then   insert the 56 places as rows (14 of them carrying a folded item's schedule)
then   delete the 14 folded item rows, journalled
then   files.place_id → files.activity_id, tips.place_id → tips.activity_id  (a rename only)
```

The whole thing is `supabase/migrations/0025_activities.sql`. What follows is why it is
shaped that way; read the file for the statements.

**`files` and `tips` need no backfill at all.** The folded row keeps the _place's_ id, so every
`place_id` in those tables already names the right activity — the column is renamed and its
foreign key re-pointed, and not one row is rewritten. That is the main practical dividend of
evolving rather than copying.

**The rollback is a snapshot, not an untouched source table** — and it is **one** table, not
two. `itinerary_items` is renamed away, so after the migration there is nothing left to restore
it from: `itinerary_items_pre_010` is that pre-image, taken inside the transaction so a write
landing between a hand-made backup and the run cannot make it stale.
`specs/010-activities/rollback.sql` brings the database back from it.

`places` gets **no** snapshot, deliberately: the migration only reads it. It is never renamed,
altered or dropped, so it survives intact and a copy would be a copy of a table still sitting
right there. It goes in the contract migration, with the rest. Copying into a fresh table would have made rollback a
`drop table` — that was the one real argument for it — and a snapshot buys the same thing for
one throwaway table, without pretending 226 rows of hand-written plan are new data.

**FR-004 — "a saved activity needs a city" — is a service rule, not a check constraint, and
that is not laziness.** Written as `check (day is not null or zone_id is not null)` alongside
`zone_id references zones(id) on delete set null`, deleting a _trip_ would fail: the cascade
nulls `zone_id` on the way to deleting the row, the check fires first, and the delete aborts.
The alternatives are both worse — `on delete cascade` on `zone_id` would destroy plan lines
with their city, which is exactly what 0002 chose `set null` to avoid, and dropping the rule
entirely would let Explore lose rows silently. So: `set null` on the FK, no check, and
`collectActivityErrors` refuses to create or update a saved activity without a city.

The state the check would have prevented is unreachable today — the datastore has no
`deleteZone` at all, and a trip delete takes the activities with it. **If a zone delete is ever
added, it owns this**: its saved activities have to be re-homed or deleted explicitly, or they
survive as rows no screen can show. Write that in the method, not here.

`activities_highlight_needs_day` **is** a constraint, because no cascade can produce a
highlight without a day.

Three widenings, each because the union of two columns has to fit. `name` keeps the
itinerary's 1–200 (the longest place name in production is 42). `description` drops the note's
1000-character cap, because a place's description holds a booking blob (the longest today is
396, but the column was never capped). And `category` gains `'other'` **and** stays nullable —
135 plan lines have no tag, and stamping them `other` would put a grey pill on 135 rows nobody
asked for.

## 3 · The fold rule

One rule, applied per place, with two exceptions.

```
place with no matching item        → one saved activity   (id = place.id, day = null)
place tagged `hotel`               → one saved activity   (id = place.id, day = null)   ← exception 1
place with N ≥ 1 MATCHING items    → N scheduled activities:
    the first (by day, position, id) takes the place's id and the place's whole record,
    plus that item's day, time, position and icon;
    the other N−1 keep their own ids and are copies.
item with a STRAY link             → one plain activity, link dropped and journalled   ← exception 2
item with no place                 → one activity, exactly as it is today
```

**"Matching" is doing real work here — see §3a.** A linked item is folded only if its title
names the place. It is not enough that `place_id` is set.

### 3a · `place_id` is not a statement of identity

**This has been cleaned in production and the rule stays anyway.** Read this section as the
reason the fold is gated, not as a description of the data you will find.

Six of the twenty-four `place_id` links pointed at the wrong place. All six came from four
bulk inserts made on 2026-08-01 between 19:10 and 19:17 — identical `created_at` to the
microsecond, so a script rather than a person:

| the place                         | the plan line that pointed at it                          |
| --------------------------------- | --------------------------------------------------------- |
| Higashi Chaya District (Kanazawa) | "Drive to Kanazawa (~1h15)"                               |
| Higashi Chaya District            | "Shirakawa-go" — a village ~50km away                     |
| Lake Kawaguchi                    | "Drive to Kawaguchiko"                                    |
| Lake Kawaguchi                    | "Oshino Hakkai"                                           |
| Kinkaku-ji (Golden Pavilion)      | "Togetsukyo Bridge, riverside walk, optional monkey park" |
| Sanmachi Suji old town            | "Miyagawa morning market along the river (07:00–12:00)"   |

Split by origin the picture was unambiguous — 18 links from those batches, 6 wrong; 6 links
typed one at a time through the app, none wrong. `AddPlaceToDay` writes `title = place.name`,
so the interactive path cannot produce a mismatch at all; the import guessed a place per row
and missed a third of the time. Nobody noticed for a month, because a link surfaces only as a
category pill and a file list.

**All six were unlinked by hand on 2026-09-01**, before any of this shipped. Production now
holds 18 links and no known strays, which empties the migration's most dangerous branch. Two of
those six were also what made the fold look dangerous: both wrong-linked places sorted _first_
by day, so an ordinal fold would have produced an activity called _"Drive to Kanazawa (~1h15)"_
carrying Higashi Chaya's address, description, photo and coordinates, then copied those
coordinates onto "Shirakawa-go" and pinned it 50km from the village.

#### The gate stays, and the heuristic is weaker than it looks

The fold is still gated on the item's title naming the place, because the cleanup fixed the
rows rather than the cause: another import can reintroduce the same class of row before the
migration runs.

But **the name match is not reliable enough to decide on its own, in either direction.** Run
against `placeholder-data.json` it flags 12 of 32 links, and most of those are _correct_:

| plan line                        | linked place        | verdict                                    |
| -------------------------------- | ------------------- | ------------------------------------------ |
| "Check in at the ryokan. Yukata" | Atami Sekaie        | correct — the heuristic cannot know        |
| "Pick one"                       | MOA Museum of Art   | correct — the title carries no name at all |
| "Evening: the ryokan"            | HOTEL WOOD TAKAYAMA | correct                                    |
| "Kenrokuen at opening"           | Kenroku-en Garden   | correct — a hyphen                         |
| "Sensoji"                        | Senso-ji Temple     | correct — a hyphen                         |
| "Oishi Park"                     | Lake Kawaguchi      | arguable — the park is _on_ the lake       |

Normalising hyphens recovers two. The rest are the ordinary case for a human-written plan line:
**the whole point of the link is that the title does not name the place.** So the heuristic
catches real errors in one dataset and manufactures false ones in the other.

That settles what the tooling is for. `npm run migrate:activities -- --report` prints every
linked pair with a proposed verdict and writes the accepted ones to
`specs/010-activities/folds.json`, which the migration reads. **The review is where the
decision is made, not a rubber stamp on a good guess** — treat a `STRAY` verdict as a question,
not an answer. Six stays among those twelve seed rows fold nowhere regardless, which caps how
much the review can get wrong.

A rejected pair is **dropped, not folded**: the item becomes a plain dated activity keeping its
city and category and **no copied location**, the place keeps its own undated row, and both go
to the journal as `source = 'stray'` so the link is recoverable if the call was wrong.

**What is left once the strays are gone: no genuine repeat visits at all.** Three places still
carry two entries — `Check` (test data created 2026-09-01), `Nishiki Market` and
`Omicho Market` — and both markets have their two entries on the **same day**: a lunch and a
snack, which the merged model expresses as two activities anyway. Higashi Chaya and Lake
Kawaguchi dropped to one entry each the moment the strays went. FR-006's trade — one saved
thing can no longer be scheduled on several days — therefore costs nothing on today's data,
which is worth knowing before paying for the occurrences table the spec declined.

**Stays are never folded.** A reservation is looked up on any night of the stay, not on the
check-in day — and `journey_steps` already model the range. Folding would move the hotel out
of Explore's **Stays** list and onto one day's plan, which is a usability regression dressed
up as consistency. Its linked items are left **entirely untouched** — they keep their own city,
their own tag (usually none) and none of the stay's booking content: the reservation stays in
exactly one row. Untouched rather than re-tagged is deliberate: stamping `hotel` on a
"Check in" line would hide it from a member whose view withholds stays (FR-021), which is not
what they see today. One row in production takes this branch — the Takayama line, journalled
as `item_stay` rather than `item_copy` precisely because nothing was copied onto it.

**A copy carries location, not record.** `address`, `image_url`, `lat` and `lng` are copied so
the second and third visits pin on the map; `links`, `name_ja`, files and tips are not — those
belong to the row that kept the id. This is deliberately the same rule the product's _Copy to
another day_ action will use, so the migration and the feature cannot drift.

**The folded row keeps the plan's words.** `name` is the item's `title`, not the place's
`name` — the day plan is the surface those 22 rows are actually read on, and changing what it
says is the one thing a data migration must not do. The place's name is not lost: where the
two differ (15 rows), `Saved as “<place name>”` is appended to the description, which is one
of the four columns search covers. Both source rows are in the journal verbatim regardless.

**Ids are preserved** so `files.place_id`, `tips.place_id`, reminder URLs, pasted links and
open bookmarks all keep resolving (FR-031). This is only safe because the pre-flight assertion
proves no id is used by both tables.

## 4 · The journal

```sql
create table if not exists activity_migration_journal (
  source      text not null check (source in ('place','item','item_copy','item_stay','fold','stray')),
  source_id   text not null,
  activity_id text not null,
  folded_with text,          -- the other row's id, where two became one
  place_row   jsonb,         -- to_jsonb(places)         — verbatim
  item_row    jsonb,         -- to_jsonb(itinerary_items) — verbatim
  migrated_at timestamptz not null default now(),
  primary key (source, source_id)
);
```

Every activity gets a row. For the 12 folds it holds both sources, which is what makes the one
lossy step — two rows becoming one — mechanically reversible. It outlives the contract phase;
it is the only copy of the fold decisions once the source tables are dropped.

**`item_copy` and `item_stay` are the same situation with opposite outcomes**, and separating
them is what keeps §6 honest. Both are matched items that did not keep the place's id; a copy
was given the place's location by the backfill, a stay-linked item was excluded from the fold
and left exactly as it arrived (§3). Filed under one name, the check *“does every copy carry a
pin?”* has to restate `p.category <> 'hotel'` to be true — a rule of the migration copied into
the query that verifies the migration, free to drift from it. It failed exactly that way on
the first run against production, where the one stay-linked row has coordinates and the three
real copies do not.

### The two new tables must have RLS on

Both tables 0025 creates hold **verbatim trip content** — the snapshot is every itinerary row,
and the journal stores `to_jsonb` of both source rows, so a hotel's booking blob is in it word
for word. Neither gets RLS by default: `create table as select` does not inherit it from the
source table, and a plain `create table` never had it. Supabase's default grants, meanwhile,
give `anon` full `SELECT/INSERT/UPDATE/DELETE` on every table in `public` — and `anon` is the
publishable key that ships inside the browser bundle.

RLS-off therefore means world-readable **and world-deletable**, the second of which takes the
rollback with it. Every other table in this schema is RLS-on with no policies: the API talks as
the service role, which bypasses RLS, and everyone else is denied. The migration matches that,
and `run-migration-test.sh` asserts it over `pg_class` rather than by name, so a table added to
the migration later is covered without anyone remembering.

> **This was found on the live project, after 0025 had already been committed and run**
> (2026-09-01). The two `enable row level security` statements were applied to production by
> hand within minutes and then folded into 0025 itself, so a fresh environment never creates
> the tables unprotected even briefly. Production and the migration agree; nothing diverged.

## 5 · The backfill

`supabase/migrations/0025_activities.sql`, as one transaction. Four things in it are worth
knowing without reading the SQL:

**It refuses to run twice.** The pre-flight aborts if `activities` already exists, if any id is
used by both tables, or if a place sits in a zone with no trip.

**The match list is an input, not a computation.** The `_match` values block is the reviewed
output of §3a and is the one part that must be regenerated per environment — a link created
between the review and the run is absent from the list and would be treated as a stray. The
file ships with production's 18 reviewed pairs and says so.

**A folded row is written once, not written and then patched.** The place's INSERT left-joins
its folded item, so `name` is `coalesce(item.name, place.name)` and the description is the
place's, the item's note and `Saved as "<place name>"` concatenated — with the note dropped
only when it repeats the description **word for word**. A near-duplicate is left in: redundant
text can be edited away, dropped text cannot.

**A copy carries location, not record.** The 2nd and later matched days get the place's
address, photo and coordinates so they pin, and not its links, `name_ja`, files or tips — those
stay with the row that kept the id.

### It has been run

Not reasoned about — run, against Postgres 16 loaded from the committed migrations plus
`placeholder-data.json` (39 places, 189 items, 32 links) and four synthetic rows production's
data does not cover: a place tagged `other`, an activity with no city, a stray link, and a
multi-day place carrying coordinates.

| assertion                                                                                                                            |      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `activities = places + items − folds`                                                                                                | PASS |
| journal covers every activity                                                                                                        | PASS |
| no pre-migration row missing (both tables)                                                                                           | PASS |
| **the day plan reads identically** — same text, same times, same order, every day                                                    | PASS |
| invariants: no nameless row, no saved row without a city, no undated highlight, no orphaned file or tip, no stray keeping a location | PASS |
| stays are never given a date                                                                                                         | PASS |
| a copy of a located place carries the pin                                                                                            | PASS |

The harness rebuilds the database from scratch each run, so it is re-runnable after any edit to
the SQL. The fourth row is the one that matters most: **191 plan lines before, 191 after, and
zero that changed their text, their time or their position.**

## 6 · Verification, on the day

```sql
-- every source row is represented exactly once
select (select count(*) from places)                                        as places,
       (select count(*) from itinerary_items_pre_010)                       as items,
       (select count(*) from activities)                                    as activities,
       (select count(*) from activity_migration_journal)                    as journalled,
       (select count(*) from activity_migration_journal where source='fold') as folds;
-- expect: activities = places + items − folds, and journalled = activities

-- nothing lost its name, its city or its parent
select count(*) from activities where name is null or btrim(name) = '';          -- 0
select count(*) from activities where day is null and zone_id is null;           -- 0
select count(*) from activities where highlight and day is null;                 -- 0
select count(*) from files f where f.activity_id is not null
  and not exists (select 1 from activities a where a.id = f.activity_id);        -- 0
select count(*) from tips t where t.activity_id is not null
  and not exists (select 1 from activities a where a.id = t.activity_id);        -- 0

-- no stray kept a coordinate it has no right to (§3a)
select count(*) from activities a
join activity_migration_journal j on j.activity_id = a.id and j.source = 'stray'
where a.lat is not null or a.address is not null;                                -- 0

-- no stay was moved onto a day (§3), and every copy carries the pin it was
-- given (§4 — the reason `item_stay` is not filed as `item_copy`)
select count(*) from activities a
join activity_migration_journal j on j.activity_id = a.id and j.source = 'fold'
where a.category = 'hotel' and a.day is not null;                                -- 0
select count(*) from activity_migration_journal j
join activities a on a.id = j.activity_id
join places p     on p.id = j.folded_with
where j.source = 'item_copy' and p.lat is not null and a.lat is null;            -- 0

-- THE one: the day plan says exactly what it said before
with b as (select day, title as name, start_time, row_number() over
             (partition by day order by (start_time is null), start_time, position, id) rn
           from itinerary_items_pre_010),
     a as (select day, name, start_time, row_number() over
             (partition by day order by (start_time is null), start_time, position, id) rn
           from activities where day is not null)
select count(*) from b full outer join a on a.day = b.day and a.rn = b.rn
where b.name is distinct from a.name or b.start_time is distinct from a.start_time;  -- 0
```

On the 2026-09-01 snapshot, after the §3a cleanup, that is `places` 56, `items` 226,
`folds` **14** → `activities` **268**, `journalled` 268. The 18 remaining links split
14 `fold` · 3 `item_copy` (all same-day) · 1 `item_stay`, with no `stray` left.
Re-derive it on the day; the identity `activities = places + items − folds` is the thing to
check, not the figure.

## 7 · The phases

| phase            | what runs                                                                                                                             | what is reversible                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 · migrate**  | `0025_activities.sql` against the live project, dry-run first (`commit` → `rollback`) with §6 in the same transaction. No code ships. | Everything, and trivially: the dry run commits nothing.                                                                                                       |
| **2 · cut over** | Deploy the code that reads and writes `activities`.                                                                                   | `rollback.sql`, tested to restore the database byte-identically. **Activities written during phase 2 are lost by it** — they have no shape in the old schema. |
| **3 · contract** | After a soak: drop `places`, `activities.place_id`, `itinerary_items_pre_010`. Keep the journal.                    | Only through the journal.                                                                                                                                     |

Phase 2's window is the real risk and it is not hidden: two trips are actively edited, so a
soak of a week costs almost nothing and a dual-write shim would cost a service layer writing
both shapes for the sake of a fortnight. That trade is the recommendation, not a constraint —
if the window is unacceptable, say so and the shim goes in the plan.

**Do not skip the dry run.** Replace the final `commit` with `rollback`, paste §6 above it, and
read the numbers. The snapshot tables are created inside the same transaction, so a rollback
discards them too and leaves nothing behind.

## 8 · The revert

`specs/010-activities/rollback.sql`, pre-written and **tested** — because the point of a
rollback is that nobody has to reason it out while the app is down. It re-points `files` and
`tips` back to `place_id`, drops `activities`, recreates `itinerary_items` with the DDL of
0002 + 0004 + 0022, and refills it from `itinerary_items_pre_010`.

Verified against a scratch Postgres by building a pristine reference database from the same
migrations and seed, migrating a second one, rolling it back, and comparing: **the DDL of
`itinerary_items`, `files` and `tips` is identical, and so are the row digests of
`itinerary_items`, `places`, `files` and `tips`.** `places` is never modified by 0025 — it is
only read — which is why it is not snapshotted in the first place.

What it loses is stated at the top of the file: **every activity written after the migration
ran.** A row created in the new shape has no place in the old one, and the script does not
invent one — it does not silently drop them either, it tells you how to count them first:

```sql
select count(*) from activities where id not in (select activity_id from activity_migration_journal);
```

That number growing is exactly what makes phase 3 wait rather than follow phase 2 immediately.

**What it keeps is the journal**, on purpose — it is the only record of what the fold decided,
and it costs nothing. The consequence is that a rolled-back project cannot re-run 0025 until
the journal is dropped, since the journal's primary key would collide. 0025's pre-flight
refuses that case by name rather than letting it surface two hundred lines later as
`duplicate key`: read the journal, `drop table activity_migration_journal`, then re-run.

## 9 · The seed file is data too

`server/src/data/placeholder-data.json` is not fixture data — it is the seed the deployed
database was built from, and it is what local dev and every test read. It carries 39 places
and 189 itinerary items (31 of them linked, 1 place scheduled twice) and must go through the
same fold, in the same commit as the code
cutover, or `npm test` runs against a shape the app no longer has.

`scripts/migrate-placeholder.ts` applies §3 to the JSON and rewrites it in place. It is the
same rule expressed twice, so `server/tests/migration-fold.test.ts` runs the TypeScript fold
and the SQL fold over the same fixture rows and asserts they agree — the discipline
`server/tests/ordering.test.ts` already uses to stop the client's copy of the sort order
drifting from the datastore's.

`scripts/seed.ts` needs its `places` / `itinerary` inserts replaced with one `activities`
insert; `npm run check:db` needs the new table in its sanity list; `scripts/backfill-coords.ts`
writes `activities.lat`/`lng` instead of `places.lat`/`lng`, and its journal format is
unchanged.
