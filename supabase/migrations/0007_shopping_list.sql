-- Japan Trip Companion — shopping list ("things to buy in Japan").
-- Trip-level wishlist: what to buy, where, roughly how much it should cost, a
-- photo to recognise it by, and whether it has been bought yet. The optional
-- zone_id links an item to the city its shop is in (kept when a zone is
-- removed → null). Run after 0001_init.sql in the Supabase SQL editor.

create table if not exists shopping_items (
  id         text primary key,
  trip_id    text not null references trips(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  category   text not null default 'other'
             check (category in ('clothes','beauty','tech','snacks','home','souvenir','other')),
  note       text check (char_length(note) <= 1000),
  shop       text check (char_length(shop) <= 120),
  zone_id    text references zones(id) on delete set null,
  price_yen  integer check (price_yen is null or price_yen between 0 and 10000000),
  url        text,
  image_url  text,
  bought     boolean not null default false,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shopping_trip_idx on shopping_items (trip_id, bought, position);

-- updated_at trigger (mirrors 0001_init.sql) ---------------------------------
drop trigger if exists set_updated_at on shopping_items;
create trigger set_updated_at before update on shopping_items
  for each row execute function set_updated_at();

-- Row Level Security: deny all except the service-role key -------------------
alter table shopping_items enable row level security;
