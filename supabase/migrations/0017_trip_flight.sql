-- Japan Trip Companion — user accounts, step 6: the flight belongs to a trip.
--
-- `FLIGHT` was a module constant in server/src/lib/flight.ts holding the two
-- travellers' own Ethiopian Airlines booking, and `getTripBundle` attached it
-- to whichever trip was being read. With one trip that was just where the data
-- lived. With open registration it means a stranger's first trip to anywhere
-- arrives carrying somebody else's booking reference and ticket times.
--
-- jsonb rather than a `trip_flights` table: legs are read as a block and never
-- edited individually, so a table would buy a join and two store methods for
-- nothing. If legs ever become separately editable, that is the moment to
-- split them out.
--
-- Run after 0016.

alter table trips add column if not exists flight jsonb;

-- Seeded onto the trip it actually belongs to, and no other. Every trip
-- created since — and every trip created from here on — has no flight until
-- someone attaches one, which the app renders as "no flights added yet".
update trips
   set flight = jsonb_build_object(
     'airline', 'Ethiopian Airlines',
     'booking_ref', 'AOXIUF',
     'outbound', jsonb_build_object(
       'depart_at', '2026-09-18T15:35:00+03:00',
       'depart_tz', 'Asia/Jerusalem',
       'arrive_at', '2026-09-19T19:40:00+09:00',
       'arrive_tz', 'Asia/Tokyo',
       'legs', jsonb_build_array(
         jsonb_build_object('flight_no', 'ET 419', 'from', 'Tel Aviv (TLV)', 'to', 'Addis Ababa (ADD)'),
         jsonb_build_object('flight_no', 'ET 672', 'from', 'Addis Ababa (ADD)', 'to', 'Narita (NRT)')
       )
     ),
     'return_flight', jsonb_build_object(
       'depart_at', '2026-10-16T20:40:00+09:00',
       'depart_tz', 'Asia/Tokyo',
       'arrive_at', '2026-10-17T14:35:00+03:00',
       'arrive_tz', 'Asia/Jerusalem',
       'legs', jsonb_build_array(
         jsonb_build_object('flight_no', 'ET 673', 'from', 'Narita (NRT)', 'to', 'Addis Ababa (ADD)'),
         jsonb_build_object('flight_no', 'ET 418', 'from', 'Addis Ababa (ADD)', 'to', 'Tel Aviv (TLV)')
       )
     )
   )
 where id = 'trip-japan'
   and flight is null;
