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

## 2 · The target table

```sql
create table if not exists activities (
  id          text primary key,
  trip_id     text not null references trips(id) on delete cascade,
  zone_id     text references zones(id) on delete set null,
  category    text check (category is null or category in
                ('hotel','attraction','food','shopping','other')),
  name        text not null check (char_length(name) between 1 and 200),
  name_ja     text,
  description text,
  address     text,
  links       jsonb not null default '[]'::jsonb,
  image_url   text,
  lat         double precision check (lat is null or lat between -90 and 90),
  lng         double precision check (lng is null or lng between -180 and 180),
  day         date,
  start_time  text check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  position    int not null default 0,
  highlight   boolean not null default false,
  icon        text check (icon is null or char_length(icon) <= 16),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- FR-005: a featured note banners a day, so it needs one.
  constraint activities_highlight_needs_day check (not highlight or day is not null)
);
create index if not exists activities_trip_day_idx  on activities (trip_id, day);
create index if not exists activities_saved_idx     on activities (zone_id, category)
  where day is null;

-- the same trigger every other table carries (0001)
drop trigger if exists set_updated_at on activities;
create trigger set_updated_at before update on activities
  for each row execute function set_updated_at();

-- deny all except the service-role key, like every other table
alter table activities enable row level security;
```

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

Three widenings, each because the union of two columns has to fit: `name` takes the
itinerary's 200 rather than the place's 120; `description` takes the place's uncapped text
rather than the note's 1000 (the service still validates 2000 on write); `category` becomes
nullable, because 135 plan lines have no tag and stamping them `other` would put a grey pill
on 135 rows nobody asked for.

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

### 3a · A quarter of the links are wrong

The obvious fold rule — _take the first linked item by `(day, position, id)`_ — was the first
draft of this document, and the data kills it. Six of the twenty-four `place_id` links in
production point at the wrong place:

| the place                         | the plan line pointing at it                              |
| --------------------------------- | --------------------------------------------------------- |
| Higashi Chaya District (Kanazawa) | "Drive to Kanazawa (~1h15)"                               |
| Higashi Chaya District            | "Shirakawa-go" — a village ~50km away                     |
| Lake Kawaguchi                    | "Drive to Kawaguchiko"                                    |
| Lake Kawaguchi                    | "Oshino Hakkai"                                           |
| Kinkaku-ji (Golden Pavilion)      | "Togetsukyo Bridge, riverside walk, optional monkey park" |
| Sanmachi Suji old town            | "Miyagawa morning market along the river (07:00–12:00)"   |

Both wrong-linked places happen to sort **first** by day, so an ordinal fold would have
produced an activity called _"Drive to Kanazawa (~1h15)"_ carrying Higashi Chaya's address,
description, photo and coordinates — and would then have copied those coordinates onto
"Shirakawa-go", putting a pin 50km from the village. Silent, plausible-looking, and wrong on
the one surface (the map) this feature exists to add.

**They all came from one import, not from the app.** Every one of the six sits inside four bulk
inserts made on 2026-08-01 between 19:10 and 19:17 (identical `created_at` to the microsecond —
a script, not a person tapping). Split by origin, the picture is unambiguous:

| how the link was made                | links | wrong |
| ------------------------------------ | ----- | ----- |
| typed one at a time, through the app | 6     | **0** |
| bulk insert, 2026-08-01              | 18    | **6** |

`AddPlaceToDay` writes `title = place.name`, so the interactive path _cannot_ produce a
mismatch; the import guessed a place per row and missed a third of the time. Nobody noticed
because the link is nearly invisible in the UI — it surfaces only as a category pill and a file
list.

Two consequences. The damage is **bounded and will not grow on its own**, so this is a
data-cleaning job rather than a running defect — but it will grow if another import is run
before the migration, which is why the fold's `--report` pass is not a one-off. And the
migration **cannot treat `place_id` as a statement of identity**, because a third of the values
it would be trusting were never asserted by a human.

**So the fold is gated on the name, not on the link.** Normalise both sides (lower-case, strip
punctuation and hyphens, drop parentheticals) and fold when the place's distinctive tokens
appear in the title. That accepts `Kenroku-en Garden` ← "Kenrokuen Garden at opening",
`Fushimi Inari Shrine` ← "Fushimi Inari at sunrise" and `Higashi Chaya District` ←
"Higashi Chaya teahouse district again for gold-leaf ice cream", and rejects every row in the
table above. A stray link is **dropped** — the item becomes a plain dated activity keeping its
city and category and **no copied location** — and both rows go to the journal as
`source = 'stray'`, so the link is recoverable if one of these turns out to be deliberate.

**The heuristic proposes; a human disposes.** `npm run migrate:activities -- --report` prints
every candidate pair with its verdict and writes the accepted ids to
`specs/010-activities/folds.json`, which the migration reads. Seventeen places is a ten-minute
review, and a threshold that gets Higashi Chaya wrong is worse than a list somebody looked at.
The heuristic exists so the same script still works on the seed file (31 linked items) and on
anything created between the review and the run — those get reported, not assumed.

**What is left once the strays are gone: no genuine repeat visits at all.** Higashi Chaya and
Lake Kawaguchi have exactly one real entry each. Nishiki Market and Omicho Market have two
entries on the **same day** — a lunch and a snack, not a second visit. The only place spanning
two days is "Check", which is test data. FR-006's trade — one saved thing can no longer be
scheduled on several days — therefore costs nothing on today's data, which is worth knowing
before paying for the occurrences table the spec declined.

**Stays are never folded.** A reservation is looked up on any night of the stay, not on the
check-in day — and `journey_steps` already model the range. Folding would move the hotel out
of Explore's **Stays** list and onto one day's plan, which is a usability regression dressed
up as consistency. Its linked items become ordinary activities carrying the stay's city and
category and **none** of its booking content (no address, no links, no photo, no coordinates):
the reservation stays in exactly one row. One row in production takes this branch.

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
  source      text not null check (source in ('place','item','item_copy','fold','stray')),
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

## 5 · The backfill

Written as one transaction against a temporary table, so the "which item folded" decision is
computed once and every branch reads the same answer.

```sql
begin;

-- pre-flight: abort rather than trust the table in §1 -------------------------
do $$
declare n int;
begin
  select count(*) into n from places p join itinerary_items i on i.id = p.id;
  if n > 0 then raise exception 'id collision: % row(s) share an id', n; end if;
  select count(*) into n from places p join zones z on z.id = p.zone_id where z.trip_id is null;
  if n > 0 then raise exception '% place(s) sit in a zone with no trip', n; end if;
end $$;

-- the reviewed match list (§3a): one row per (place, item) pair confirmed to be
-- the same thing. Produced by `migrate:activities --report` and eyeballed; a
-- `place_id` that is NOT in here is a stray link and is dropped, not folded.
create temporary table _match (place_id text not null, item_id text primary key);
insert into _match (place_id, item_id) values
  -- …generated from specs/010-activities/folds.json…
  (null, null);
delete from _match where item_id is null;

-- which matched item folds into its place, and which are copies ---------------
create temporary table _fold on commit drop as
select m.item_id,
       m.place_id,
       row_number() over (partition by m.place_id order by i.day, i.position, i.id) as rn
from _match m
join itinerary_items i on i.id = m.item_id
join places p         on p.id = m.place_id
where p.category <> 'hotel';          -- stays never fold (§3)

-- A · the folded rows: place record + that item's schedule --------------------
insert into activities (id, trip_id, zone_id, category, name, name_ja, description,
                        address, links, image_url, lat, lng,
                        day, start_time, position, highlight, icon, created_at)
select p.id, z.trip_id, p.zone_id,
       coalesce(i.category, p.category),
       i.title,
       p.name_ja,
       nullif(concat_ws(E'\n\n',
         nullif(p.description, ''),
         nullif(i.note, ''),
         case when lower(btrim(i.title)) is distinct from lower(btrim(p.name))
              then 'Saved as “' || p.name || '”' end), ''),
       p.address, p.links, p.image_url, p.lat, p.lng,
       i.day, i.start_time, i.position, i.highlight, i.icon,
       least(p.created_at, i.created_at)
from _fold f
join itinerary_items i on i.id = f.item_id
join places p         on p.id = f.place_id
join zones z          on z.id = p.zone_id
where f.rn = 1;

-- B · every other place: saved, undated --------------------------------------
insert into activities (id, trip_id, zone_id, category, name, name_ja, description,
                        address, links, image_url, lat, lng,
                        day, start_time, position, highlight, icon, created_at)
select p.id, z.trip_id, p.zone_id, p.category, p.name, p.name_ja, p.description,
       p.address, p.links, p.image_url, p.lat, p.lng,
       null, null, 0, false, null, p.created_at
from places p
join zones z on z.id = p.zone_id
where not exists (select 1 from _fold f where f.place_id = p.id and f.rn = 1);

-- C · every itinerary item that did not fold ---------------------------------
--     four cases in one statement, because they differ only in what the two
--     left joins find: free text (no place), a matched copy (rn ≥ 2), an item
--     hanging off a stay, and a STRAY link (§3a).
--
--     `m` — not `p` — gates the copied location. A stray's place_id is not a
--     statement about where the activity is, so copying its coordinates would
--     pin Shirakawa-go at Higashi Chaya.
insert into activities (id, trip_id, zone_id, category, name, name_ja, description,
                        address, links, image_url, lat, lng,
                        day, start_time, position, highlight, icon, created_at)
select i.id, i.trip_id,
       coalesce(i.zone_id, p.zone_id),
       coalesce(i.category, p.category),
       i.title, null, nullif(i.note, ''),
       -- a matched copy carries location; a stray and a stay carry none (§3, §3a)
       case when m.item_id is not null and p.category <> 'hotel' then p.address   end,
       '[]'::jsonb,
       case when m.item_id is not null and p.category <> 'hotel' then p.image_url end,
       case when m.item_id is not null and p.category <> 'hotel' then p.lat       end,
       case when m.item_id is not null and p.category <> 'hotel' then p.lng       end,
       i.day, i.start_time, i.position, i.highlight, i.icon, i.created_at
from itinerary_items i
left join _match m on m.item_id = i.id
left join places p on p.id = i.place_id
where not exists (select 1 from _fold f where f.item_id = i.id and f.rn = 1);

-- the journal ----------------------------------------------------------------
insert into activity_migration_journal (source, source_id, activity_id, folded_with,
                                        place_row, item_row)
select 'fold', p.id, p.id, i.id, to_jsonb(p), to_jsonb(i)
from _fold f
join itinerary_items i on i.id = f.item_id
join places p         on p.id = f.place_id
where f.rn = 1;

insert into activity_migration_journal (source, source_id, activity_id, place_row)
select 'place', p.id, p.id, to_jsonb(p)
from places p
where not exists (select 1 from _fold f where f.place_id = p.id and f.rn = 1);

insert into activity_migration_journal (source, source_id, activity_id, folded_with, item_row)
select case when i.place_id is null      then 'item'
            when m.item_id is not null   then 'item_copy'
            else 'stray' end,            -- the link was dropped; §3a
       i.id, i.id, i.place_id, to_jsonb(i)
from itinerary_items i
left join _match m on m.item_id = i.id
where not exists (select 1 from _fold f where f.item_id = i.id and f.rn = 1);

-- re-point the children -------------------------------------------------------
alter table files add column if not exists activity_id text
  references activities(id) on delete set null;
update files set activity_id = place_id where place_id is not null;
alter table files drop constraint if exists files_check;      -- verified name, see §5 note
alter table files add constraint files_one_parent
  check (num_nonnulls(trip_id, zone_id, activity_id) = 1);

alter table tips add column if not exists activity_id text
  references activities(id) on delete cascade;
update tips set activity_id = place_id where place_id is not null;
alter table tips drop constraint if exists tips_check;        -- verified name, see §5 note
alter table tips add constraint tips_one_parent
  check (num_nonnulls(zone_id, activity_id) = 1);

commit;
```

`files.place_id` and `tips.place_id` are **kept**, with their foreign keys intact — they still
resolve, because `places` is still there. They are what the revert reads.

The two `drop constraint` names were read off the live project rather than guessed — 0001
declared both checks inline, so Postgres generated them, and they came back as
`files_check := CHECK ((num_nonnulls(trip_id, zone_id, place_id) = 1))` and
`tips_check := CHECK ((num_nonnulls(zone_id, place_id) = 1))`. **Re-read them before running
anyway.** A `drop constraint if exists` against a name that has since changed silently does
nothing and leaves the old check in place, which then rejects every write to `files` — a
failure that appears at the first upload, not at migration time:

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid in ('files'::regclass, 'tips'::regclass) and contype = 'c';
```

## 6 · Verification, before the code ships

```sql
-- every source row is represented exactly once
select (select count(*) from places)                                       as places,
       (select count(*) from itinerary_items)                              as items,
       (select count(*) from activities)                                   as activities,
       (select count(*) from activity_migration_journal)                   as journalled,
       (select count(*) from activity_migration_journal where source='fold') as folds;
-- expect: activities = places + items − folds, and journalled = activities

-- nothing lost its city, its day or its name
select count(*) from activities where name is null or btrim(name) = '';         -- 0
select count(*) from activities where day is null and zone_id is null;          -- 0
select count(*) from activities a left join trips t on t.id = a.trip_id
  where t.id is null;                                                            -- 0
select count(*) from files where place_id is not null and activity_id is null;  -- 0
select count(*) from tips  where place_id is not null and activity_id is null;  -- 0

-- the fold is the only place a row count drops, and it is journalled
select source, count(*) from activity_migration_journal group by source order by 1;
```

On the 2026-09-01 snapshot, with the strays of §3a excluded, that is `places` 56, `items` 226,
`folds` **14** → `activities` **268**, `journalled` 268. The 24 linked items split
14 folded · 3 matched copies · 6 stray · 1 hanging off a stay. Re-derive it on the day; the
identity `activities = places + items − folds` is the thing to check, not the figure.

```sql
-- no stray kept a coordinate it has no right to (§3a)
select count(*) from activities a
join activity_migration_journal j on j.activity_id = a.id and j.source = 'stray'
where a.lat is not null or a.address is not null;                                -- 0
```

## 7 · The phases

| phase            | what runs                                                                                                | what is reversible                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **1 · expand**   | §5 against the live project. No code ships.                                                              | Everything: drop `activities`, restore the two checks. The app has not read the new table yet.                              |
| **2 · cut over** | Deploy the code that reads and writes `activities`. `places` / `itinerary_items` go stale but stay.      | Code revert + `drop table activities`. **Writes made during phase 2 do not reach the old tables and are lost by a revert.** |
| **3 · contract** | After a soak: `drop table itinerary_items`, `drop table places`, drop `files.place_id`, `tips.place_id`. | Only through the journal.                                                                                                   |

Phase 2's window is the real risk and it is not hidden: two trips are actively edited, so a
soak of a week costs almost nothing and a dual-write shim would cost a service layer that
writes both shapes for the sake of a fortnight. That trade is the recommendation, not a
constraint — if the window is unacceptable, say so and the shim goes in the plan.

**Do not skip phase 1's dry run.** Run §5 inside `begin; … rollback;` first with the §6
queries in the same transaction, and read the numbers. A `rollback` after a successful
`create temporary table … on commit drop` is safe.

## 8 · The revert

```
npm run migrate:activities -- --revert
```

Reads the journal and rebuilds `places` and `itinerary_items` from `place_row` / `item_row`,
then re-points `files.activity_id`/`tips.activity_id` back to `place_id` and restores the
original checks. Because both source rows are stored verbatim, a fold reverses exactly — the
appended `Saved as “…”` line and the merged note are discarded rather than parsed back out.

Rows **created after** the migration have no journal entry. The script reports them and does
not invent history for them: it writes them into `itinerary_items` if they have a day and into
`places` if they do not, and prints the id of every row it converted so the loss (a saved
activity's files surviving, a scheduled activity's location not) is visible rather than
assumed. That asymmetry is exactly why phase 3 waits.

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
