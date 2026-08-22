-- Japan Trip Companion — the currencies a trip is calculated in.
--
-- Two halves of the same feature:
--
-- 1. `trips.home_currencies` joins `trips.local_currency` (0010, which nothing
--    read until now). Together they are the exchange calculator's two sides:
--    amounts are typed in the local currency and shown in the home ones. The
--    defaults are exactly what the calculator was hard-coded to before —
--    JPY in, USD and ILS out — so every existing trip keeps its behaviour.
--
-- 2. `exchange_rates` stops being a two-column JPY table. One row per base
--    currency still, but the quotes now live in a jsonb map keyed by ISO code,
--    because "which currencies" is a per-trip answer now. The old usd/ils
--    columns stay (nullable, still written) so a rollback to the previous
--    deploy finds a row it can read.
--
-- Run in the Supabase SQL editor after 0018.

alter table trips
  add column if not exists local_currency text not null default 'JPY',
  add column if not exists home_currencies text[] not null default '{USD,ILS}';

-- A row that somehow arrived with an empty array would render a calculator
-- with no output cards; treat it as "never chosen".
update trips set home_currencies = '{USD,ILS}'
  where home_currencies is null or cardinality(home_currencies) = 0;

alter table exchange_rates
  add column if not exists rates jsonb;

update exchange_rates
  set rates = jsonb_strip_nulls(jsonb_build_object('USD', usd, 'ILS', ils))
  where rates is null;

alter table exchange_rates alter column usd drop not null;
alter table exchange_rates alter column ils drop not null;
