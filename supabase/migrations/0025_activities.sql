-- 010: places and itinerary_items become one thing — an activity.
--
-- An activity is what an itinerary item always was, plus the four things only a
-- place could carry: a location, an address, links and a photo — and minus the
-- requirement to have a date. A dated activity is on the day plan; an undated
-- one is in the city's Explore list; any activity with coordinates is on the map.
--
-- This EVOLVES itinerary_items rather than copying it, because 226 of the 282
-- rows are already the right shape and the 56 places are the small side. The
-- rollback story is `*_pre_010` below, not an untouched source table.
--
-- Not deployed by committing it: run this against the live project (Supabase SQL
-- editor, or the Supabase MCP apply_migration). Run it as ONE transaction, and
-- dry-run it first by replacing the final `commit` with `rollback` — §7 of
-- specs/010-activities/migration.md.

begin;

-- 0 · pre-flight: abort rather than trust anyone's notes ----------------------
do $$
declare n int;
begin
  if to_regclass('public.activities') is not null then
    raise exception '0025 has already run: activities exists';
  end if;
  select count(*) into n from places p join itinerary_items i on i.id = p.id;
  if n > 0 then raise exception 'id collision: % row(s) share an id', n; end if;
  select count(*) into n from places p join zones z on z.id = p.zone_id where z.trip_id is null;
  if n > 0 then raise exception '% place(s) sit in a zone with no trip', n; end if;
end $$;

-- 1 · the snapshot. This IS the rollback: one table per source, taken before a
--     single row moves, dropped by hand at the contract phase (§7).
create table itinerary_items_pre_010 as select * from itinerary_items;
create table places_pre_010          as select * from places;

-- 2 · the journal — every folding decision, both source rows verbatim ---------
create table if not exists activity_migration_journal (
  source      text not null check (source in ('place','item','item_copy','fold','stray')),
  source_id   text not null,
  activity_id text not null,
  folded_with text,
  place_row   jsonb,
  item_row    jsonb,
  migrated_at timestamptz not null default now(),
  primary key (source, source_id)
);

-- 3 · the table becomes what it always was -----------------------------------
alter table itinerary_items rename to activities;
alter table activities rename column title to name;
alter table activities rename column note  to description;

-- an activity need not have a date; that is the whole feature
alter table activities alter column day drop not null;

-- a place's description holds a booking blob, which the note's cap would refuse
alter table activities drop constraint itinerary_items_note_check;

-- the plan could only be tagged with the four it can draw a pill for; a place
-- can also be 'other', and after the merge they are the same column
alter table activities drop constraint itinerary_items_category_check;
alter table activities add constraint activities_category_check
  check (category is null or category in ('hotel','attraction','food','shopping','other'));

-- the four things only a place could carry
alter table activities
  add column name_ja   text,
  add column address   text,
  add column image_url text,
  add column links     jsonb not null default '[]'::jsonb,
  add column lat       double precision check (lat is null or lat between -90 and 90),
  add column lng       double precision check (lng is null or lng between -180 and 180);

-- FR-005: a featured note banners a day, so it needs one. (FR-004's mirror —
-- "a saved activity needs a city" — is deliberately a service rule and not a
-- constraint: as a check it would abort trip deletion. See migration.md §2.)
alter table activities add constraint activities_highlight_needs_day
  check (not highlight or day is not null);

alter index itinerary_trip_day_idx rename to activities_trip_day_idx;
create index activities_saved_idx on activities (zone_id, category) where day is null;

-- 4 · the reviewed match list (migration.md §3a) ------------------------------
--     One row per (place, item) pair confirmed to be the same thing. A place_id
--     that is NOT in here is a stray link: it is dropped, not folded.
--     REGENERATE AND RE-REVIEW before running — rows created since the review
--     are absent from this list and would be silently treated as strays.
create temporary table _match (place_id text not null, item_id text primary key) on commit drop;
insert into _match (place_id, item_id) values
  ('attr-arashiyama',                        'itin-d-20261004-82'),
  ('attr-chureito',                          'itin-d-20260928-52'),
  ('attr-fushimi',                           'itin-d-20261005-87'),
  ('attr-higashichaya',                      'itin-d-20261002-74'),
  ('attr-kenrokuen',                         'itin-d-20261002-72'),
  ('attr-kawaguchi',                         'itin-d-20260927-50'),
  ('attr-matsumoto-castle',                  'itin-d-20260928-54'),
  ('attr-owakudani',                         'itin-d-20260926-45'),
  ('attr-shibuya',                           '78e1906a-e104-4ca6-bfd7-dfae3680890b'),
  ('attr-usj',                               '8a902db1-6a37-417c-b916-67d17c769acf'),
  ('b7ecf304-a54c-428c-af28-03712c71efa9',   'ba7129e3-a83d-4557-9305-72a597049bd4'),
  ('b7ecf304-a54c-428c-af28-03712c71efa9',   '87e3aa55-391e-4b9c-a125-69ca43422241'),
  ('c26418f5-5661-4101-b699-d0f2755e1982',   '1ffb74b7-2b00-448e-bdde-c10420ed40ba'),
  ('1586b6d1-e476-4db6-b2fa-745d4ca8526c',   'b0ff874b-f879-4aad-9240-f52276ac476b'),
  ('shop-nishiki',                           'itin-d-20261005-88'),
  ('shop-nishiki',                           'itin-d-20261005-90'),
  ('shop-omicho',                            'itin-d-20261002-73'),
  ('shop-omicho',                            'itin-d-20261002-75');

-- which matched item folds into its place, and which are copies. Stays never
-- fold: a reservation is looked up on any night of the stay, not on one day.
create temporary table _fold on commit drop as
select m.item_id,
       m.place_id,
       row_number() over (partition by m.place_id order by a.day, a.position, a.id) as rn
from _match m
join activities a on a.id = m.item_id
join places p     on p.id = m.place_id
where p.category <> 'hotel';

-- 5 · the places become rows. A folded place carries its item's schedule and
--     the plan's words; every other place arrives undated.
insert into activities (id, trip_id, zone_id, category, name, name_ja, description,
                        address, links, image_url, lat, lng,
                        day, start_time, position, highlight, icon, place_id, created_at)
select p.id,
       z.trip_id,
       p.zone_id,
       coalesce(it.category, p.category),
       -- the item's title wins: the day plan is the surface these rows are read
       -- on, and changing what it says is what a migration must not do (§3)
       coalesce(it.name, p.name),
       p.name_ja,
       case
         when it.id is null then p.description
         else nullif(concat_ws(E'\n\n',
                nullif(p.description, ''),
                -- the note, unless it repeats the description word for word. Only
                -- an exact match is dropped: a near-duplicate is left in, because
                -- redundant text can be edited away and dropped text cannot.
                case when btrim(coalesce(it.description, '')) = btrim(coalesce(p.description, ''))
                     then null else nullif(it.description, '') end,
                case when lower(btrim(it.name)) is distinct from lower(btrim(p.name))
                     then 'Saved as ' || '"' || p.name || '"' end), '')
       end,
       p.address, p.links, p.image_url, p.lat, p.lng,
       it.day, it.start_time, coalesce(it.position, 0),
       coalesce(it.highlight, false), it.icon,
       null,
       least(p.created_at, coalesce(it.created_at, p.created_at))
from places p
join zones z on z.id = p.zone_id
left join _fold f      on f.place_id = p.id and f.rn = 1
left join activities it on it.id = f.item_id;

-- 6 · a matched copy (the 2nd and later days) carries location, not record:
--     address, photo and coordinates so it pins, but not links, name_ja, files
--     or tips — those belong to the row that kept the id. Same rule the app's
--     "Copy to another day" uses, so the two cannot drift.
update activities a
set address   = p.address,
    image_url = p.image_url,
    lat       = p.lat,
    lng       = p.lng,
    category  = coalesce(a.category, p.category)
from _fold f
join places p on p.id = f.place_id
where f.item_id = a.id and f.rn > 1;

-- 7 · journal every row, then drop the folded item rows (now duplicates) ------
insert into activity_migration_journal (source, source_id, activity_id, folded_with,
                                        place_row, item_row)
select 'fold', f.place_id, f.place_id, f.item_id, to_jsonb(p), to_jsonb(pre)
from _fold f
join places p                    on p.id  = f.place_id
join itinerary_items_pre_010 pre on pre.id = f.item_id
where f.rn = 1;

insert into activity_migration_journal (source, source_id, activity_id, place_row)
select 'place', p.id, p.id, to_jsonb(p)
from places p
where not exists (select 1 from _fold f where f.place_id = p.id and f.rn = 1);

insert into activity_migration_journal (source, source_id, activity_id, folded_with, item_row)
select case when pre.place_id is null    then 'item'
            when m.item_id is not null   then 'item_copy'
            else 'stray' end,
       pre.id, pre.id, pre.place_id, to_jsonb(pre)
from itinerary_items_pre_010 pre
left join _match m on m.item_id = pre.id
where not exists (select 1 from _fold f where f.item_id = pre.id and f.rn = 1);

delete from activities where id in (select item_id from _fold where rn = 1);

-- 8 · files and tips re-point by rename: the folded row kept the PLACE's id,
--     so every place_id already names the right activity. No backfill at all.
alter table files drop constraint files_check;
alter table files drop constraint files_place_id_fkey;
alter table files rename column place_id to activity_id;
alter table files add constraint files_one_parent
  check (num_nonnulls(trip_id, zone_id, activity_id) = 1);
alter table files add constraint files_activity_id_fkey
  foreign key (activity_id) references activities(id) on delete set null;

alter table tips drop constraint tips_check;
alter table tips drop constraint tips_place_id_fkey;
alter table tips rename column place_id to activity_id;
alter table tips add constraint tips_one_parent
  check (num_nonnulls(zone_id, activity_id) = 1);
alter table tips add constraint tips_activity_id_fkey
  foreign key (activity_id) references activities(id) on delete cascade;

-- `activities.place_id` survives the soak pointing at `places`, unread by the
-- app. Both go in the contract migration (0026), not here.

commit;
