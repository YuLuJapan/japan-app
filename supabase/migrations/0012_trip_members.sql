-- Japan Trip Companion — user accounts, step 2: per-trip membership.
--
-- This is the table that replaces TRIP_OWNER_EMAILS. Until now the app asked
-- "is this email one of the two travellers?"; from here it asks "is this
-- account a member of this trip?" — which is what lets anyone register without
-- seeing anyone else's trip.
--
-- Two independent axes, deliberately not collapsed into one:
--   role            — which *verbs*: owner > partner > viewer
--   can_see_*       — which *content*, for viewers only
-- Writers (owner/partner) ignore the flags entirely; server/src/lib/trip-view.ts
-- forces them true rather than validating them, so an owner can never lock
-- themselves out of their own bookings.
--
-- Run after 0011. Invariant enforced in the service, not the schema (Postgres
-- cannot express it without a deferred constraint trigger): every trip has at
-- least one owner. A trip with zero members is invisible to everyone forever.

create table if not exists trip_members (
  trip_id           text not null references trips(id)    on delete cascade,
  user_id           uuid not null references profiles(id) on delete cascade,
  role              text not null check (role in ('owner','partner','viewer')),
  -- Viewer content visibility. Defaults match the invite screen: knowing where
  -- you are staying is the point of sharing a trip, while a document is a raw
  -- file whose contents the owner cannot audit at a glance.
  can_see_stays     boolean not null default true,
  can_see_flight    boolean not null default true,
  can_see_documents boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (trip_id, user_id)
);

-- "Which trips are mine?" runs on every trips-list request.
create index if not exists trip_members_user_idx on trip_members (user_id);

drop trigger if exists set_updated_at on trip_members;
create trigger set_updated_at before update on trip_members
  for each row execute function set_updated_at();

alter table trip_members enable row level security;
