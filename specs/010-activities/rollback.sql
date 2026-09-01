-- 010 rollback — undoes supabase/migrations/0025_activities.sql.
--
-- Deliberately pre-written and tested (against a scratch Postgres loaded from
-- the committed migrations plus the seed), because the point of a rollback is
-- that nobody has to reason it out while the app is down.
--
-- `places` is never modified by 0025 — it is only read — so there is nothing to
-- restore there; `places_pre_010` is belt and braces. `itinerary_items` is the
-- table that was evolved, and it comes back from `itinerary_items_pre_010`.
--
-- WHAT THIS LOSES: every activity written after 0025 ran. Rows created in the
-- new shape have no place in the old one, and this script does not invent one.
-- That window is the whole reason the contract phase waits (migration.md §7).
-- Check before running:
--     select count(*) from activities
--     where id not in (select activity_id from activity_migration_journal);

begin;

do $$
begin
  if to_regclass('public.itinerary_items_pre_010') is null then
    raise exception 'no snapshot: itinerary_items_pre_010 is missing, cannot roll back';
  end if;
end $$;

-- 1 · files and tips go back to naming a place -------------------------------
alter table files drop constraint files_one_parent;
alter table files drop constraint files_activity_id_fkey;
alter table files rename column activity_id to place_id;

alter table tips drop constraint tips_one_parent;
alter table tips drop constraint tips_activity_id_fkey;
alter table tips rename column activity_id to place_id;

-- 2 · the evolved table goes ---------------------------------------------------
drop table activities cascade;

-- 3 · itinerary_items comes back, with the DDL of 0002 + 0004 + 0022 ----------
create table itinerary_items (
  id         text primary key,
  trip_id    text not null references trips(id) on delete cascade,
  zone_id    text references zones(id) on delete set null,
  place_id   text references places(id) on delete set null,
  day        date not null,
  start_time text check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  title      text not null check (char_length(title) between 1 and 200),
  note       text check (char_length(note) <= 1000),
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  highlight  boolean not null default false,
  icon       text check (icon is null or char_length(icon) <= 16),
  category   text check (category is null or category in
               ('hotel','attraction','food','shopping'))
);
create index itinerary_trip_day_idx on itinerary_items (trip_id, day);
drop trigger if exists set_updated_at on itinerary_items;
create trigger set_updated_at before update on itinerary_items
  for each row execute function set_updated_at();
alter table itinerary_items enable row level security;

insert into itinerary_items
  (id, trip_id, zone_id, place_id, day, start_time, title, note, position,
   created_at, updated_at, highlight, icon, category)
select id, trip_id, zone_id, place_id, day, start_time, title, note, position,
       created_at, updated_at, highlight, icon, category
from itinerary_items_pre_010;

-- 4 · the parent checks and keys the rename dropped ---------------------------
alter table files add constraint files_check
  check (num_nonnulls(trip_id, zone_id, place_id) = 1);
alter table files add constraint files_place_id_fkey
  foreign key (place_id) references places(id) on delete set null;

alter table tips add constraint tips_check
  check (num_nonnulls(zone_id, place_id) = 1);
alter table tips add constraint tips_place_id_fkey
  foreign key (place_id) references places(id) on delete cascade;

-- 5 · the migration's own scaffolding ------------------------------------------
drop table itinerary_items_pre_010;
drop table places_pre_010;
-- The journal is deliberately KEPT: it is the record of what the fold did, and
-- it costs nothing. Drop it by hand once the decision to stay rolled back is final.

commit;
