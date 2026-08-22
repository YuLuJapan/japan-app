// The shape of a trip's flight, and the one rule for reading it back.
//
// This used to be a module constant holding the travellers' own Ethiopian
// Airlines booking, served with every trip bundle — which was fine while there
// was one trip and became indefensible the moment anyone could sign up: a
// stranger's brand-new trip to Rome came with someone else's booking reference
// on it. The data now lives on the trip it belongs to (`trips.flight`, jsonb,
// migration 0017) and a trip without one simply has none.
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

/**
 * A `trips.flight` jsonb value, or null when there isn't a usable one.
 *
 * jsonb is schemaless, so this is the only place the shape is enforced: a row
 * hand-edited in the SQL editor, or written before a field existed, must not
 * reach the countdown as a half-object. Anything that doesn't hold up reads as
 * "no flight booked", which the UI already has a card for.
 */
export function normalizeFlight(value: unknown): FlightInfo | null {
  if (!value || typeof value !== 'object') return null
  const flight = value as Record<string, unknown>
  const outbound = normalizeItinerary(flight.outbound)
  const returnFlight = normalizeItinerary(flight.return_flight)
  if (!outbound || !returnFlight) return null
  if (typeof flight.airline !== 'string' || typeof flight.booking_ref !== 'string') return null
  return {
    airline: flight.airline,
    booking_ref: flight.booking_ref,
    outbound,
    return_flight: returnFlight,
  }
}

function normalizeItinerary(value: unknown): FlightItinerary | null {
  if (!value || typeof value !== 'object') return null
  const itinerary = value as Record<string, unknown>
  const strings = ['depart_at', 'depart_tz', 'arrive_at', 'arrive_tz'] as const
  if (strings.some((key) => typeof itinerary[key] !== 'string')) return null
  if (!Array.isArray(itinerary.legs)) return null
  const legs = itinerary.legs.filter(
    (leg): leg is FlightLeg =>
      !!leg &&
      typeof leg === 'object' &&
      typeof (leg as FlightLeg).flight_no === 'string' &&
      typeof (leg as FlightLeg).from === 'string' &&
      typeof (leg as FlightLeg).to === 'string'
  )
  if (!legs.length) return null
  return {
    depart_at: itinerary.depart_at as string,
    depart_tz: itinerary.depart_tz as string,
    arrive_at: itinerary.arrive_at as string,
    arrive_tz: itinerary.arrive_tz as string,
    legs,
  }
}
