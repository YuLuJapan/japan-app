-- Japan Trip Companion — more than one conversation per trip (feature 006).
--
-- Run after 0023.
--
-- NOT DEPLOYED BY COMMITTING THIS. The Supabase project has no migration
-- runner — run this against it (SQL editor, or the Supabase MCP
-- apply_migration) as a separate act. Skip it and every test still passes,
-- because tests use the memory store, while "Start over" 500s in production
-- the first time somebody taps it.
--
-- WHAT CHANGES, AND WHY THE OLD RULE IS NOT SIMPLY WRONG
-- ------------------------------------------------------
-- 0023 put a unique constraint on `chat_threads.trip_id` and said, correctly,
-- that the constraint *was* the rule: one shared conversation per trip, no
-- per-user threads, no filtering of history. That rule is about **who can read
-- what**, and it is unchanged — every thread here is still shared by everyone
-- who can open chat, and chat is still owners-and-partners only.
--
-- What changes is that a conversation can be *finished*. Starting a new one
-- used to mean deleting the old, which threw away the only record of what the
-- travellers had asked. Now the old thread is archived: kept, unreadable in the
-- app, and there to be re-opened if we ever build that.
--
-- So the invariant becomes "one **active** thread per trip", and it is still
-- the database that holds it — a partial unique index rather than a service
-- rule, for exactly the reason 0023 gave.

alter table chat_threads
  add column if not exists archived_at timestamptz;

-- The old rule, dropped only so the narrower one can replace it. Postgres named
-- it when 0023 wrote `trip_id text not null unique`; `if exists` makes this
-- re-runnable and survives a project where it was named by hand.
alter table chat_threads
  drop constraint if exists chat_threads_trip_id_key;

-- The rule, restated: a trip has at most one conversation you can add to.
-- Archived threads are exempt, which is what lets there be a history of them.
--
-- A partial unique *index* rather than a constraint because a constraint cannot
-- carry a predicate. The consequence is that `on conflict` cannot name it
-- without repeating the predicate, which PostgREST will not do — so
-- `createChatThread` inserts and re-reads on a duplicate rather than upserting.
-- That is a real cost of this design, written down rather than discovered.
create unique index if not exists chat_threads_one_active_per_trip
  on chat_threads (trip_id)
  where archived_at is null;

-- Finding a trip's archived conversations, newest first, for whenever they
-- become readable. Cheap to add now and awkward to remember later.
create index if not exists chat_threads_archived_idx
  on chat_threads (trip_id, archived_at desc)
  where archived_at is not null;

-- The transcript is now read **per thread**, not per trip: a trip-scoped read
-- would hand the model the messages of conversations the travellers have
-- already finished with. 0023's `(trip_id, created_at)` index served the old
-- read and is left in place — it still serves tenancy checks and the eventual
-- history view — but this is the one every turn uses.
create index if not exists chat_messages_thread_idx
  on chat_messages (thread_id, created_at);
