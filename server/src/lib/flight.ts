// Outbound flight facts, from the Ethiopian Airlines e-tickets (booking AOXIUF).
// Trip-level metadata that isn't in the DB; served only via the authenticated
// /api/trip bundle so the booking reference never ships in the public JS bundle.

export interface FlightLeg {
  flight_no: string
  from: string
  to: string
}

export interface FlightInfo {
  airline: string
  booking_ref: string
  /** First departure (ET 419 out of TLV, 3:35pm), as an absolute instant. Israel is UTC+3 in September. */
  depart_at: string
  legs: FlightLeg[]
}

export const FLIGHT: FlightInfo = {
  airline: 'Ethiopian Airlines',
  booking_ref: 'AOXIUF',
  depart_at: '2026-09-18T15:35:00+03:00',
  legs: [
    { flight_no: 'ET 419', from: 'Tel Aviv (TLV)', to: 'Addis Ababa (ADD)' },
    { flight_no: 'ET 672', from: 'Addis Ababa (ADD)', to: 'Narita (NRT)' },
  ],
}
