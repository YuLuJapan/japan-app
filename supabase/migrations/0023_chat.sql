-- Japan Trip Companion — chat (feature 005), read-only phase.
--
-- Three tables: a conversation per trip, its messages, and a ledger that
-- counts what the model cost. Run after 0022.
--
-- NOT DEPLOYED BY COMMITTING THIS. The Supabase project has no migration
-- runner — run this against it (SQL editor, or the Supabase MCP
-- apply_migration) as a separate act. Skip it and every test still passes,
-- because tests use the memory store, while the deployed feature 500s on its
-- very first request.
--
-- Id convention follows every table since 0001: `text` primary keys holding an
-- app-generated randomUUID(). `profiles.id` is the exception — a real `uuid`,
-- because it comes from Supabase Auth rather than from us.

-- One conversation per trip ---------------------------------------------------
--
-- Chat is limited to owners and partners, and writers always get the full view
-- (the can_see_* flags are ignored for them, not merely unset). So everyone who
-- can open chat already sees the whole trip and a shared transcript can reveal
-- nothing — which is what lets there be exactly one thread, with no per-user
-- threads and no filtering of history. The unique constraint on trip_id *is*
-- that rule; it is not an optimisation.
create table if not exists chat_threads (
  id              text primary key,
  trip_id         text not null unique references trips(id) on delete cascade,
  -- The turn lock. Null when idle; stamped while a turn is running, so a second
  -- send is refused rather than starting a second loop against one context.
  --
  -- A timestamp rather than a boolean, deliberately: a turn whose serverless
  -- function died would hold a boolean forever and the only recovery would be
  -- manual. A timestamp is compared against a staleness window, so an abandoned
  -- turn expires on its own.
  turn_started_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The transcript --------------------------------------------------------------
--
-- `content` is TEXT IN OUR OWN SHAPE, never the provider's content blocks.
-- This is the whole portability argument: persisting Anthropic blocks would put
-- the vendor inside the database, where no adapter can reach it, and changing
-- provider would become a data migration over a live conversation instead of
-- one file. The same rule holds at the other edge — the browser receives our
-- event union, never a raw provider stream event.
create table if not exists chat_messages (
  id         text primary key,
  thread_id  text not null references chat_threads(id) on delete cascade,
  -- Denormalised so a trip-scoped read never needs the join. Every read in this
  -- app is trip-scoped by construction (routes/ sit under /api/trips/:tripId).
  trip_id    text not null references trips(id) on delete cascade,
  -- Who wrote it. NULL for the assistant.
  --
  -- `on delete set null` rather than cascade: a member removed from the trip
  -- keeps their messages in the shared conversation. Deleting half a dialogue
  -- because someone left would make the remaining half unreadable. Ordinary for
  -- a shared conversation — decided here rather than discovered later.
  user_id    uuid references profiles(id) on delete set null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

-- The transcript is read whole, oldest first, and only ever for one trip.
create index if not exists chat_messages_trip_idx on chat_messages (trip_id, created_at);

-- The ledger ------------------------------------------------------------------
--
-- Named for the capability, not for chat. Three AI capabilities are already
-- planned across the board — this chat and its tool loop (005/006), document
-- extraction (007), image generation (backlog) — and they share no unit: tokens
-- with a cache-read discount versus whole images priced one to two orders of
-- magnitude higher. A `chat_usage` table could not hold an image row, and three
-- per-capability tables could not answer "what did this month cost".
--
-- So one table, one comparable column. `cost_cents` is computed at write time
-- from server/src/lib/ai/models.ts rather than derived on read: the cap query
-- would otherwise have to know every historical price, and a rate change would
-- retroactively rewrite what last month cost.
create table if not exists ai_usage (
  id          text primary key,
  -- The account the spend is charged to. NOT NULL, while trip_id is nullable:
  -- the cap is per account, so somebody with three trips has one budget rather
  -- than three. Not every future capability will even have a trip.
  user_id     uuid not null references profiles(id) on delete cascade,
  trip_id     text references trips(id) on delete set null,
  capability  text not null check (capability in ('chat')),
  vendor      text not null,
  -- The catalogue key, e.g. 'anthropic/claude-opus-5' — namespaced so the
  -- vendor is readable wherever a row is.
  model       text not null,
  unit        text not null check (unit in ('tokens')),
  -- The raw counters, kept alongside the price so a row can be re-checked
  -- against the catalogue later. For tokens: input, output, cache_write,
  -- cache_read.
  quantity    jsonb not null,
  cost_cents  numeric(12, 4) not null check (cost_cents >= 0),
  created_at  timestamptz not null default now()
);

-- The only hot query: this account's spend this calendar month, run before
-- every turn.
create index if not exists ai_usage_account_idx on ai_usage (user_id, created_at);
-- The global kill switch sums the same rows without an account.
create index if not exists ai_usage_month_idx on ai_usage (created_at);

-- The cap's two queries, as functions -----------------------------------------
--
-- Summing in the application would mean fetching every row of the month to add
-- them up — on the request path, before every turn, growing with use. These do
-- it in one statement each.
--
-- `coalesce(..., 0)` matters more than it looks: an account that has never
-- spent anything has no rows, and `sum()` over no rows is NULL, not zero. A
-- NULL compared against the cap is neither over nor under it, which would let
-- the very first turn through a check that had silently stopped working.
create or replace function ai_usage_spend_cents(p_user_id uuid, p_since timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(sum(cost_cents), 0)
  from ai_usage
  where user_id = p_user_id and created_at >= p_since
$$;

create or replace function ai_usage_total_cents(p_since timestamptz)
returns numeric
language sql
stable
as $$
  select coalesce(sum(cost_cents), 0)
  from ai_usage
  where created_at >= p_since
$$;

-- The `capability` and `unit` checks are deliberately narrow. A second
-- capability is a one-line migration that has to be written by someone who has
-- decided what it costs — which is the same argument as the typecheck guard on
-- the model catalogue, made in the schema.

-- updated_at trigger (set_updated_at() comes from 0001) ----------------------
-- Only chat_threads changes after insert; messages and usage rows are
-- append-only and have nothing to update.
drop trigger if exists set_updated_at on chat_threads;
create trigger set_updated_at before update on chat_threads
  for each row execute function set_updated_at();

-- Row Level Security: deny all except the secret key --------------------------
-- Enabled with no policies, matching every table since 0001. The server holds
-- the secret key and is the only client; the browser never talks to Postgres.
alter table chat_threads  enable row level security;
alter table chat_messages enable row level security;
alter table ai_usage      enable row level security;
