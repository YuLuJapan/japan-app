-- Japan Trip Companion — a fourth thing a viewer may or may not be shown:
-- the shopping list.
--
-- The three existing flags all guard *bookings* — where you sleep, how you fly,
-- and the files those come as. The shopping list is a different kind of
-- private: it is where the gifts and the surprises get written down, so the
-- person they are for is exactly the person you may want to share the rest of
-- the trip with and not this. Same shape as the others (server/src/lib/
-- trip-view.ts collapses the row into one TripView), so nothing else changes.
--
-- Default true, like stays and flight: a shared trip shows its shopping list
-- unless someone says otherwise. Documents stay the one thing off by default,
-- because a file's contents cannot be audited at a glance.
--
-- Run after 0018.

alter table trip_members add column if not exists can_see_shopping boolean not null default true;
alter table trip_invites add column if not exists can_see_shopping boolean not null default true;
