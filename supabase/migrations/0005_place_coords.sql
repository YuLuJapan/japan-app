-- Japan Trip Companion — map coordinates for places.
-- Lets a place appear as a pin on its city map. Coordinates come from the
-- in-app OpenStreetMap search (server/src/services/geocode.ts) when a place is
-- pinned or located; they stay null for places that were never mapped.
-- Run after 0001_init.sql. Safe to run before the app ships: the Supabase
-- store falls back to the pre-0005 column set when these columns are absent.

alter table places
  add column if not exists lat double precision check (lat is null or lat between -90 and 90),
  add column if not exists lng double precision check (lng is null or lng between -180 and 180);
