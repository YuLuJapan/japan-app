-- 008: the country becomes something you pick rather than something you type.
--
-- Added beside `trips.country` (0015) rather than replacing it. The text column
-- keeps its meaning, its 80-character cap and every existing value: the trip
-- title falls back to it, and the legacy currency guess and Essentials gating
-- still read it for trips written before this column existed. Text without a
-- code is therefore the ordinary state of every trip that exists today, not a
-- broken row.
--
-- Nothing is backfilled. A code is recorded only when a traveller picks one
-- from the list — guessing "Japan" from "japan " would be recording a country
-- nobody chose, the same mistake as backfilling terms acceptance.
--
-- Not deployed by committing it: run this against the live project (Supabase SQL
-- editor, or the Supabase MCP apply_migration). Until it runs, the store reads
-- the column as null and writes drop it, so the trip sheet keeps working.

alter table trips
  add column if not exists country_code text
  check (country_code is null or country_code ~ '^[A-Z]{2}$');
