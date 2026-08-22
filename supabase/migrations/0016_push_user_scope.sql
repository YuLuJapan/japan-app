-- Japan Trip Companion — user accounts, step 6: whose phone is this?
--
-- `push_subscriptions` predates accounts and records only a device: an
-- endpoint and two keys. `dispatchDueReminders` therefore sent every due
-- reminder to every registered device, which was fine while the only devices
-- belonged to the two travellers and is a cross-account leak the moment
-- anyone else registers. A reminder's title is free text — "Book the ryokan",
-- "Call the clinic" — so this leaks content, not just the fact of a schedule.
--
-- The fix is one column. Dispatch then goes reminder → trip → its members →
-- their devices, and a device only ever hears about trips its owner is on.
--
-- Run after 0015.

alter table push_subscriptions
  add column if not exists user_id uuid references profiles(id) on delete cascade;

-- Devices registered before accounts existed carry nothing that identifies
-- their owner — an Apple/FCM endpoint is opaque. They are attributed by rule
-- rather than by guesswork: each unattributed device goes to an owner of the
-- oldest trip, paired in a stable order. That set is exactly the people who
-- could have registered a device back then, and while they share only that one
-- trip the pairing is unobservable — every one of them receives the same
-- reminders either way. It stops being arbitrary the first time each device
-- re-registers, which the app now does on load (src/lib/push.ts), stamping the
-- account actually signed in.
with legacy as (
  select id, row_number() over (order by created_at, id) - 1 as n
  from push_subscriptions
  where user_id is null
), owners as (
  select m.user_id,
         row_number() over (order by p.email) - 1 as n,
         count(*) over () as total
  from trip_members m
  join profiles p on p.id = m.user_id
  where m.role = 'owner'
    and m.trip_id = (select id from trips order by created_at limit 1)
)
update push_subscriptions s
   set user_id = o.user_id
  from legacy l
  join owners o on o.n = l.n % o.total
 where s.id = l.id;

-- Deliberately loud: if anything is still unattributed the backfill above did
-- not cover it, and silently allowing null would restore the broadcast.
alter table push_subscriptions alter column user_id set not null;

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);
