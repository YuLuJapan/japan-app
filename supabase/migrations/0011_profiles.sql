-- Japan Trip Companion — user accounts, step 1: profiles.
--
-- Mirrors auth.users for the rows the app itself owns. The backend uses the
-- secret key and could read auth.users directly, but: the app needs a
-- display_name it controls (the members list, and the auto-title's fallback
-- when a trip has no travellers listed), joining an app table beats reaching
-- into the auth schema from PostgREST, and the memory datastore needs an
-- equivalent so tests never touch Supabase.
--
-- Rows are upserted by the API on the first authenticated request of a
-- session (server/src/lib/identity.ts), not by a trigger on auth.users —
-- that keeps the memory and Supabase backends behaving identically.
--
-- Run after 0009. Like every other table here, RLS is on with no policies:
-- anon/authenticated are denied entirely and only the secret key gets in.

create table if not exists profiles (
  id           uuid primary key,
  email        text not null unique,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Case-insensitive lookup by email: how an invite finds the account it was
-- addressed to (phase 4), and how the members backfill maps TRIP_OWNER_EMAILS
-- onto real users.
create unique index if not exists profiles_email_lower_idx on profiles (lower(email));

drop trigger if exists set_updated_at on profiles;
create trigger set_updated_at before update on profiles
  for each row execute function set_updated_at();

alter table profiles enable row level security;
