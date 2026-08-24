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

const legless = { ...itinerary, legs: [] }

const flight = {
  airline: 'Ethiopian Airlines',
  booking_ref: 'ABC123',
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
    ['a direction with no legs at all', { ...flight, outbound: legless, return_flight: legless }],
    ['a string where an object belongs', 'ABC123'],
    ['an array', [flight]],
  ])('refuses %s rather than passing it on', (_case, value) => {
    expect(normalizeFlight(value)).toBeNull()
  })

  // These three were refusals until flights became editable from the trip form.
  // A leg — a flight number and two airports — is the part worth carrying; the
  // booking reference and the ticket times are what you look up later, and a
  // return is often not booked yet. Refusing the whole flight over any of them
  // threw away the part someone had actually typed in.
  it('keeps a one-way booking', () => {
    const oneWay = normalizeFlight({ ...flight, return_flight: undefined })
    expect(oneWay?.outbound?.legs).toEqual(itinerary.legs)
    expect(oneWay?.return_flight).toBeUndefined()
  })

  it('keeps a booking with no reference or airline', () => {
    const bare = normalizeFlight({ ...flight, booking_ref: undefined, airline: undefined })
    expect(bare?.outbound?.legs).toEqual(itinerary.legs)
    expect(bare?.booking_ref).toBeUndefined()
  })

  it('keeps the legs but drops a time whose zone is missing', () => {
    // An instant without its zone renders in whichever zone the phone is in,
    // which is the bug the paired zones exist to prevent — so the pair goes.
    const half = normalizeFlight({ ...flight, outbound: { ...itinerary, arrive_tz: 42 } })
    expect(half?.outbound?.legs).toEqual(itinerary.legs)
    expect(half?.outbound?.depart_at).toBe(itinerary.depart_at)
    expect(half?.outbound?.arrive_at).toBeUndefined()
    expect(half?.outbound?.arrive_tz).toBeUndefined()
  })

  it('keeps legs with no times at all', () => {
    const noTimes = normalizeFlight({ outbound: { legs: itinerary.legs } })
    expect(noTimes?.outbound?.legs).toEqual(itinerary.legs)
    expect(noTimes?.outbound?.depart_at).toBeUndefined()
  })

  it('drops a malformed leg but keeps the flight when others survive', () => {
    const patchy = {
      ...flight,
      outbound: { ...itinerary, legs: [{ flight_no: 'ET 419' }, itinerary.legs[0]] },
    }
    expect(normalizeFlight(patchy)?.outbound?.legs).toEqual(itinerary.legs)
  })
})
