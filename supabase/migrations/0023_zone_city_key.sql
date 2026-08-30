-- 011: which visits are the same city.
--
-- A zone stops being "a city on this trip" and becomes "one visit to a city on
-- this trip". Two stops in Tokyo become two zone rows, so something has to
-- remember they are the same place: the move-between-visits picker, the
-- "2nd visit" label and the map's trip-scale chips all need to know.
--
-- NOT THE NAME. Matching on name is precisely the find-or-create rule this
-- spec removes, and it stops being true the moment someone renames one stay
-- ("Tokyo — last days"). `city_key` is set once, at creation, and is never
-- rewritten: a rename changes what a visit is called, not which city it is.
--
-- Nullable, and nothing depends on it being present — a zone with no key
-- simply has no siblings, which is exactly how a city visited once already
-- behaves. That is what makes this column safe to add ahead of the code.
--
-- Backfilled here because today it is derivable from the name: one zone per
-- city is the very state this spec is about to end. Keep the expression in
-- step with `cityKeyFor` in server/src/lib/city-key.ts — same trim, same
-- lower-casing, same internal-whitespace collapse — or a zone created by the
-- app and a zone backfilled here would disagree about being siblings.
--
-- SPLITTING THE ROWS IS NOT DONE HERE. Dividing a repeated city's places
-- between its visits is a judgement about which stay each one belongs to, it
-- runs once against live data, and it needs a dry run, a journal and an undo.
-- That is `npm run split:visits`.
--
-- Not deployed by committing it: run this against the live project (Supabase
-- SQL editor, or the Supabase MCP apply_migration) BEFORE deploying the app.
-- Every zone read selects this column, so the app 500s on its first city page
-- if it ships first — and every test still passes, because tests use the
-- memory store.

alter table zones add column if not exists city_key text;

update zones
   set city_key = lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
 where city_key is null;

-- Every sibling lookup is "the other visits of this city, on this trip".
create index if not exists zones_trip_city_key_idx on zones (trip_id, city_key);
