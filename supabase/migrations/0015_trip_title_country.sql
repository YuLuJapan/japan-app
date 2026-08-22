-- Japan Trip Companion — user accounts, step 5: the trip's title.
--
-- A trip no longer has to be named. When `name` is empty the app builds a
-- title from who is going and where — "Yuval and Luciana in Japan" — so
-- creating a trip is one less thing to think of, and a trip is never called
-- "Untitled" unless it genuinely has nothing to go on.
--
-- `name` therefore becomes an *override* rather than the title, and drops its
-- NOT NULL. `country` is what the fallback needs; nothing derives it from the
-- zones, because a trip has no stops on the day it is created and that is
-- exactly when it needs a name.
--
-- The title itself is computed server-side (server/src/lib/trip-title.ts) and
-- returned as `display_title`, so there is one implementation and clients
-- cannot drift from it.
--
-- Run after 0014.

alter table trips alter column name drop not null;

-- The existing check ran on a column that could not be null; keep the length
-- bound but let the column be absent.
alter table trips drop constraint if exists trips_name_check;
alter table trips
  add constraint trips_name_check check (name is null or char_length(name) between 1 and 120);

alter table trips add column if not exists country text;
alter table trips drop constraint if exists trips_country_check;
alter table trips
  add constraint trips_country_check check (country is null or char_length(country) between 1 and 80);
