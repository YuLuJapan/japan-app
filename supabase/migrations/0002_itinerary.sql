-- Japan Trip Companion — day-by-day itinerary.
-- Adds itinerary_items: one activity on one calendar day, optionally linked to a
-- saved place and/or scheduled at a time. Deleting a place keeps its day plan
-- (place_id → null). Run after 0001_init.sql in the Supabase SQL editor.

create table if not exists itinerary_items (
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
  updated_at timestamptz not null default now()
);
create index if not exists itinerary_trip_day_idx on itinerary_items (trip_id, day);

-- updated_at trigger (mirrors 0001_init.sql) ---------------------------------
drop trigger if exists set_updated_at on itinerary_items;
create trigger set_updated_at before update on itinerary_items
  for each row execute function set_updated_at();

-- Row Level Security: deny all except the service-role key -------------------
alter table itinerary_items enable row level security;
