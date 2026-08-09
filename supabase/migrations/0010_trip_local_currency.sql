-- Japan Trip Companion — per-trip local currency.
-- Onward now supports trips to any destination, so the money calculator
-- (Essentials tab) needs to know each trip's local currency instead of
-- assuming yen. Defaults every existing row (and any insert that omits it)
-- to 'JPY' so the original Japan trip keeps working unchanged. Run after 0009.

alter table trips
  add column if not exists local_currency text not null default 'JPY';
