-- Japan Trip Companion — user accounts, step 4: invites.
--
-- How someone else gets onto a trip. The owner (or a partner, for viewers
-- only) mints a link; whoever opens it and signs in becomes a member with the
-- role and visibility the invite promised.
--
-- No email is ever sent. The link is copied and shared over WhatsApp — which
-- is consistent with how `trips.people` already offers a mailto: invite, and
-- keeps the whole feature inside the free tier.
--
-- TOKENS ARE STORED HASHED. The plaintext is returned exactly once, at mint
-- time, and never again — the same discipline as a password reset token. A
-- leaked database backup therefore hands out no working invites.
--
-- `owner` is deliberately ungrantable: the check constraint below is what
-- makes "a partner cannot promote anyone past themselves" a property of the
-- schema rather than of the service that happens to write it.
--
-- Run after 0013.

create table if not exists trip_invites (
  id          text primary key,
  trip_id     text not null references trips(id) on delete cascade,
  -- null = an open link; set = only that address may accept it.
  email       text,
  role        text not null check (role in ('partner','viewer')),
  -- The visibility the invite promises, copied onto trip_members at accept.
  can_see_stays     boolean not null default true,
  can_see_flight    boolean not null default true,
  can_see_documents boolean not null default false,
  token_hash  text not null unique,
  invited_by  uuid references profiles(id) on delete set null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references profiles(id) on delete set null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Accepting looks the invite up by token hash and nothing else, so this is the
-- hot path; listing a trip's pending invites is the other.
create index if not exists trip_invites_trip_idx on trip_invites (trip_id);

drop trigger if exists set_updated_at on trip_invites;
create trigger set_updated_at before update on trip_invites
  for each row execute function set_updated_at();

alter table trip_invites enable row level security;
