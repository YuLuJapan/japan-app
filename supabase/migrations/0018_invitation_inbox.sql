-- Japan Trip Companion — user accounts, step 7: an invitation finds you.
--
-- Until now an invite was a link and nothing else: the token *was* the
-- authorization, so someone who never received the link — or lost it in a
-- chat thread — had no way to discover they had been invited at all.
--
-- An invite addressed to an email address is now claimable by the account
-- that owns that address, without the link. The authorization becomes "your
-- confirmed sign-in email matches the invitation", which is why the API
-- refuses to list or claim anything for an account whose email Supabase has
-- not confirmed: an unconfirmed address proves nothing about who holds it.
--
-- `declined_at` is a state of its own rather than a reuse of `revoked_at`.
-- Revoked means the inviter withdrew it; declined means the invitee said no,
-- and the inviter deserves to see which of the two happened.
--
-- Run after 0017.

alter table trip_invites add column if not exists declined_at timestamptz;

-- Finding "every open invitation addressed to me" is now a hot path of its
-- own, and it matches case-insensitively because email addresses do.
create index if not exists trip_invites_email_idx
  on trip_invites (lower(email))
  where email is not null;
