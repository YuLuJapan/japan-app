-- Japan Trip Companion — multi-trip support, step 1 (data model only).
-- The `trips` table already supported multiple rows (no uniqueness constraint
-- forcing a single trip); this just adds the field the new "Onward" trip
-- picker needs: who's travelling on each trip (free-text names, not linked
-- accounts — see chats/chat1.md in the design handoff). Everything else
-- (journey_steps, itinerary_items, shopping_items, reminders, files) already
-- carries trip_id and needs no schema change. Run after 0008.

alter table trips
  add column if not exists people jsonb not null default '[]'::jsonb;

alter table trips
  drop constraint if exists trips_people_is_array;
alter table trips
  add constraint trips_people_is_array check (jsonb_typeof(people) = 'array');
