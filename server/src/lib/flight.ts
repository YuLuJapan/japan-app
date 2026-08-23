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
  /** First departure of this direction. Absent until someone fills in times. */
  depart_at?: string
  /** IANA zone of the first departure airport. */
  depart_tz?: string
  /** Final arrival of this direction. */
  arrive_at?: string
  /** IANA zone of the final arrival airport. */
  arrive_tz?: string
  /** At least one. Two or more are a connection. */
  legs: FlightLeg[]
}

export interface FlightInfo {
  airline?: string
  booking_ref?: string
  /** TLV → NRT via Addis. Its `depart_at`, when set, is the countdown target. */
  outbound?: FlightItinerary | null
  /** NRT → TLV via Addis. Absent on a one-way booking. */
  return_flight?: FlightItinerary | null
}

/**
 * A `trips.flight` jsonb value, or null when there isn't a usable one.
 *
 * jsonb is schemaless, so this is the only place the shape is enforced: a row
 * hand-edited in the SQL editor, or written before a field existed, must not
 * reach the countdown as a half-object. Anything that doesn't hold up reads as
 * "no flight booked", which the UI already has a card for.
 *
 * A leg is the part worth having: a flight number and two airports is a useful
 * thing to carry through an airport, and the times are what you look up later.
 * So times are optional, and only a direction with no legs at all is dropped.
 * The countdown asks for `depart_at` and falls back when it isn't there.
 */
export function normalizeFlight(value: unknown): FlightInfo | null {
  if (!value || typeof value !== 'object') return null
  const flight = value as Record<string, unknown>
  const outbound = normalizeItinerary(flight.outbound)
  const returnFlight = normalizeItinerary(flight.return_flight)
  // One direction is enough — a one-way booking is a real thing, and a return
  // is often added later. With neither there is nothing to show.
  if (!outbound && !returnFlight) return null
  return {
    ...(typeof flight.airline === 'string' && flight.airline ? { airline: flight.airline } : {}),
    ...(typeof flight.booking_ref === 'string' && flight.booking_ref
      ? { booking_ref: flight.booking_ref }
      : {}),
    ...(outbound ? { outbound } : {}),
    ...(returnFlight ? { return_flight: returnFlight } : {}),
  }
}

function normalizeItinerary(value: unknown): FlightItinerary | null {
  if (!value || typeof value !== 'object') return null
  const itinerary = value as Record<string, unknown>
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
  // Times travel as a pair: an instant without its zone renders in whichever
  // zone the phone happens to be in, which is the bug the zones exist to stop.
  const at = (key: 'depart' | 'arrive') => {
    const instant = itinerary[`${key}_at`]
    const zone = itinerary[`${key}_tz`]
    return typeof instant === 'string' && instant && typeof zone === 'string' && zone
      ? { [`${key}_at`]: instant, [`${key}_tz`]: zone }
      : {}
  }
  return { ...at('depart'), ...at('arrive'), legs }
}
