-- Japan Trip Companion — when the vacation itself begins.
--
-- The countdown had two settings and no middle: a trip with a booking counted
-- down to `flight.outbound.depart_at`, and every other trip counted down to
-- `start_date` at a hardcoded 09:00 local (src/components/GenericCountdown.tsx)
-- — a guess that was wrong for anyone whose trip starts with an evening flight
-- or a morning train. Filling in a whole booking just to fix the clock was the
-- only way out, which is a lot of form for one number.
--
-- Two nullable columns rather than folding a time into `start_date`: that
-- column is a `date` and every range rule in the app compares against it
-- (trip-dates.ts, the stranded-activity check, itinerary days). Widening it to
-- a timestamptz would put a time into all of those comparisons, where an
-- evening start date could suddenly exclude its own first day.
--
-- The zone travels with the time, exactly as it does on a flight leg: without
-- it, "18:00" means one instant while packing in Tel Aviv and another after
-- landing in Tokyo, and the countdown would jump the moment the phone changed
-- zone. Both null means "no particular time", and the app keeps its old
-- behaviour.
--
-- Run after 0019. (Note both 0019 files: two branches claimed that number.
-- This is deliberately 0020 to stop the sequence drifting further.)

alter table trips add column if not exists start_time text;
alter table trips add column if not exists start_tz text;
