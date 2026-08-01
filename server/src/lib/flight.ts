// Flight facts, from the Ethiopian Airlines e-tickets (booking AOXIUF).
// Trip-level metadata that isn't in the DB; served only via the authenticated
// /api/trip bundle so the booking reference never ships in the public JS bundle.
//
// Times are absolute instants; each direction also carries the IANA zone of its
// departure/arrival airport so the ticket's local times render identically on a
// phone still set to Israel and one already switched to Japan.

export interface FlightLeg {
  flight_no: string
  from: string
  to: string
}

export interface FlightItinerary {
  /** First departure of this direction. */
  depart_at: string
  /** IANA zone of the first departure airport. */
  depart_tz: string
  /** Final arrival of this direction. */
  arrive_at: string
  /** IANA zone of the final arrival airport. */
  arrive_tz: string
  legs: FlightLeg[]
}

export interface FlightInfo {
  airline: string
  booking_ref: string
  /** TLV → NRT via Addis. Its `depart_at` is the countdown target. */
  outbound: FlightItinerary
  /** NRT → TLV via Addis. */
  return_flight: FlightItinerary
}

export const FLIGHT: FlightInfo = {
  airline: 'Ethiopian Airlines',
  booking_ref: 'AOXIUF',
  outbound: {
    depart_at: '2026-09-18T15:35:00+03:00',
    depart_tz: 'Asia/Jerusalem',
    arrive_at: '2026-09-19T19:40:00+09:00',
    arrive_tz: 'Asia/Tokyo',
    legs: [
      { flight_no: 'ET 419', from: 'Tel Aviv (TLV)', to: 'Addis Ababa (ADD)' },
      { flight_no: 'ET 672', from: 'Addis Ababa (ADD)', to: 'Narita (NRT)' },
    ],
  },
  return_flight: {
    depart_at: '2026-10-16T20:40:00+09:00',
    depart_tz: 'Asia/Tokyo',
    arrive_at: '2026-10-17T14:35:00+03:00',
    arrive_tz: 'Asia/Jerusalem',
    legs: [
      { flight_no: 'ET 673', from: 'Narita (NRT)', to: 'Addis Ababa (ADD)' },
      { flight_no: 'ET 418', from: 'Addis Ababa (ADD)', to: 'Tel Aviv (TLV)' },
    ],
  },
}
