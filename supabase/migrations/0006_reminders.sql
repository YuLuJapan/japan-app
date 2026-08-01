-- Japan Trip Companion — scheduled reminders + web push subscriptions.
-- Run after 0005 in the Supabase SQL editor.
--
-- reminders: "book the ryokan" nudges. remind_at is an absolute instant, so a
-- phone still on Israel time and one already on Japan time fire together;
-- time_zone only records which wall clock was typed, for display.
-- push_subscriptions: one row per device that turned notifications on.

create table if not exists reminders (
  id         text primary key,
  trip_id    text not null references trips(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 120),
  body       text check (char_length(body) <= 500),
  url        text check (char_length(url) <= 500),
  remind_at  timestamptz not null,
  time_zone  text not null default 'UTC',
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- the dispatcher's only query: unsent rows whose time has come
create index if not exists reminders_due_idx on reminders (remind_at) where sent_at is null;
create index if not exists reminders_trip_idx on reminders (trip_id, remind_at);

create table if not exists push_subscriptions (
  id         text primary key,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  label      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at triggers (set_updated_at() comes from 0001) --------------------
do $$
declare t text;
begin
  foreach t in array array['reminders','push_subscriptions'] loop
    execute format('drop trigger if exists set_updated_at on %I', t);
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- Row Level Security: deny all except the service-role key -------------------
alter table reminders          enable row level security;
alter table push_subscriptions enable row level security;

-- ---------------------------------------------------------------------------
-- OPTIONAL: fire the dispatcher from Supabase instead of an external cron.
-- Vercel Hobby only runs cron once a day, which is useless for minute-accurate
-- reminders. pg_cron + pg_net (both free) can ping the endpoint every 5 minutes.
-- Uncomment, replace the host and the secret, and run.
--
-- create extension if not exists pg_cron with schema extensions;
-- create extension if not exists pg_net  with schema extensions;
--
-- select cron.schedule(
--   'dispatch-trip-reminders',
--   '*/5 * * * *',
--   $$
--     select net.http_post(
--       url     := 'https://YOUR-APP.vercel.app/api/reminders/dispatch',
--       headers := '{"Authorization": "Bearer YOUR_CRON_SECRET"}'::jsonb
--     );
--   $$
-- );
--
-- Undo with: select cron.unschedule('dispatch-trip-reminders');
