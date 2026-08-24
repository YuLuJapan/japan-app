-- Japan Trip Companion — recording that someone accepted the terms.
--
-- The gate has told people "By continuing you agree to the terms and privacy
-- policy" since it was written, while no such documents existed and nothing
-- recorded the agreement. Both halves are fixed together: the documents are
-- real pages now, and this is where the acceptance lands.
--
-- Two columns, not one. The instant alone answers "did they agree?" but not
-- "to what?" — and terms change. Storing the version that was accepted is what
-- lets the app re-ask when they do, instead of quietly treating a 2026
-- acceptance as consent to whatever the text says later.
--
-- Both nullable: every existing account starts un-accepted and is asked on its
-- next visit. Backfilling would be recording a consent nobody gave.
--
-- Deliberately on `profiles` rather than a `terms_acceptances` history table.
-- One row per person, overwritten on each new version, is all this app can
-- honestly use; a full audit trail implies a rigour (immutable log, the exact
-- text served) that nothing here provides.
--
-- Run after 0020.

alter table profiles add column if not exists accepted_terms_at timestamptz;
alter table profiles add column if not exists accepted_terms_version text;
