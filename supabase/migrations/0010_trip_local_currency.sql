-- Japan Trip Companion — the trip's local currency.
--
-- RECONSTRUCTED (2026-08-22). This column was applied directly to the live
-- Supabase project on 2026-08-09 (migration `trip_local_currency`) without a
-- file ever landing in this folder, so the repo could not rebuild the database
-- from scratch. Written here to match production exactly; running it against a
-- database that already has the column is a no-op.
--
-- Nothing in the app reads it yet — `Trip` in server/src/lib/datastore.ts has
-- no matching field, and the Supabase store does not select it. Wiring it up
-- is deliberately left as its own change.

alter table trips
  add column if not exists local_currency text not null default 'JPY';
