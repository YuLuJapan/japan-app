// `trips.flight` is jsonb, which Postgres will happily hold anything in. This
// is the only place its shape is checked, so a row written by hand in the SQL
// editor — or by a future version with an extra field — can't reach the
// countdown as a half-object.
import { describe, expect, it } from 'vitest'
import { normalizeFlight } from '../src/lib/flight.js'

const itinerary = {
  depart_at: '2026-09-18T15:35:00+03:00',
  depart_tz: 'Asia/Jerusalem',
  arrive_at: '2026-09-19T19:40:00+09:00',
  arrive_tz: 'Asia/Tokyo',
  legs: [{ flight_no: 'ET 419', from: 'Tel Aviv (TLV)', to: 'Addis Ababa (ADD)' }],
}

const flight = {
  airline: 'Ethiopian Airlines',
  booking_ref: 'AOXIUF',
  outbound: itinerary,
  return_flight: itinerary,
}

describe('normalizeFlight', () => {
  it('passes a complete booking through', () => {
    expect(normalizeFlight(flight)).toEqual(flight)
  })

  it('reads a trip with no booking as no flight', () => {
    expect(normalizeFlight(null)).toBeNull()
    expect(normalizeFlight(undefined)).toBeNull()
  })

  it.each([
    ['a missing return direction', { ...flight, return_flight: undefined }],
    ['a missing booking reference', { ...flight, booking_ref: undefined }],
    ['a direction with no legs', { ...flight, outbound: { ...itinerary, legs: [] } }],
    ['a direction missing its timezone', { ...flight, outbound: { ...itinerary, arrive_tz: 42 } }],
    ['a string where an object belongs', 'AOXIUF'],
    ['an array', [flight]],
  ])('refuses %s rather than passing it on', (_case, value) => {
    expect(normalizeFlight(value)).toBeNull()
  })

  it('drops a malformed leg but keeps the flight when others survive', () => {
    const patchy = {
      ...flight,
      outbound: { ...itinerary, legs: [{ flight_no: 'ET 419' }, itinerary.legs[0]] },
    }
    expect(normalizeFlight(patchy)?.outbound.legs).toEqual(itinerary.legs)
  })
})
