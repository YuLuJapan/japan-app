-- 009: let a traveller tag an activity directly.
--
-- Distinct from the day plan's `place_category`, which is derived from the
-- linked place and never stored. This is the tag typed on the activity itself,
-- so an entry that points at nothing saved can still say what kind of thing it
-- is. Nullable with no default and nothing backfilled — an untagged activity is
-- the ordinary case, and guessing a category from a title would be worse than
-- showing none.
--
-- Not deployed by committing it: run this against the live project (Supabase SQL
-- editor, or the Supabase MCP apply_migration). Until it runs, the store reads
-- the column as null and writes drop it, so the day plan keeps working.

alter table itinerary_items
  add column if not exists category text
  check (category is null or category in ('hotel', 'attraction', 'food', 'shopping'));
