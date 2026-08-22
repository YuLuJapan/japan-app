-- Japan Trip Companion — user accounts, step 3: zones belong to a trip.
--
-- The last unscoped table. Until now `zones` (and `places`, which hang off
-- them) were one global catalog shared by every trip, which is why the API had
-- to fall back on "is this zone reachable from one of your journey steps?" to
-- keep strangers out. After this the question is answered by the schema:
-- every row in the system resolves to exactly one trip.
--
-- SHARED ZONES: a zone reachable from two trips cannot simply be given one
-- trip_id — it would have to be duplicated, along with its places and tips.
-- The dry run against production found none (9 zones on exactly one trip,
-- 2 orphans, 0 shared), so rather than ship duplication logic that has never
-- run against real data, this aborts loudly if any turn up. Better a failed
-- migration than a silently mis-assigned city.
--
-- ORPHANS: two zones exist that no journey step references — debris from the
-- journey editor's find-or-create ("Chitose Police Station", "Haifa"). They
-- carry no places, tips, files or references of any kind. They are attached to
-- the oldest trip rather than deleted: nothing in the UI lists a zone except
-- through a step, so they stay invisible either way, and attaching is
-- reversible where deleting is not.
--
-- Run after 0012.

-- 1. The column, nullable for now.
alter table zones add column if not exists trip_id text references trips(id) on delete cascade;

do $$
declare
  shared_count int;
  oldest_trip  text;
begin
  -- 2. Refuse to guess when a zone belongs to more than one trip.
  select count(*) into shared_count from (
    select s.zone_id from journey_steps s
    group by s.zone_id having count(distinct s.trip_id) > 1
  ) q;
  if shared_count > 0 then
    raise exception
      'Cannot scope zones: % zone(s) are reachable from more than one trip and would need duplicating. Resolve by hand before running this migration.',
      shared_count;
  end if;

  -- 3. The ordinary case: one trip reaches the zone, so it owns it.
  update zones z
     set trip_id = s.trip_id
    from (select distinct zone_id, trip_id from journey_steps) s
   where s.zone_id = z.id and z.trip_id is null;

  -- 4. Orphans go to the oldest trip so the NOT NULL below can hold.
  select id into oldest_trip from trips order by created_at asc limit 1;
  if oldest_trip is not null then
    update zones set trip_id = oldest_trip where trip_id is null;
  end if;
end $$;

-- 5. Now it is total.
alter table zones alter column trip_id set not null;

create index if not exists zones_trip_idx on zones (trip_id);

-- A zone cannot outlive its trip, and a step cannot outlive its zone. The old
-- `on delete restrict` existed to stop a zone being deleted while a step still
-- pointed at it; with both now cascading from the same trip, restrict would
-- instead make deleting a trip fail.
alter table journey_steps drop constraint if exists journey_steps_zone_id_fkey;
alter table journey_steps
  add constraint journey_steps_zone_id_fkey
  foreign key (zone_id) references zones(id) on delete cascade;
