// The flight form's working shape, and the two conversions to the stored one.
//
// The form and the wire disagree on purpose. A form field is always a string —
// half-typed, possibly empty — while the stored booking has optional fields
// that should be absent rather than blank, and times that are instants rather
// than the date/time/zone triple someone actually types. Keeping the draft
// separate means the form never has to reason about that, and these two
// functions are pure, so the rules are testable without rendering anything.
import type { FlightInfo, FlightItinerary, FlightLeg } from '../api/types'
import { deviceTimeZone, instantToZoned, zonedToInstant } from './flight-time'

export interface LegDraft {
  flight_no: string
  from: string
  to: string
}

export interface DirectionDraft {
  /** One leg is a direct flight; each extra leg is a connection. */
  legs: LegDraft[]
  departDate: string
  departTime: string
  departTz: string
  arriveDate: string
  arriveTime: string
  arriveTz: string
}

export interface FlightDraft {
  airline: string
  booking_ref: string
  outbound: DirectionDraft
  return_flight: DirectionDraft
}

export const emptyLeg = (): LegDraft => ({ flight_no: '', from: '', to: '' })

export const emptyDirection = (): DirectionDraft => ({
  legs: [emptyLeg()],
  departDate: '',
  departTime: '',
  departTz: deviceTimeZone(),
  arriveDate: '',
  arriveTime: '',
  arriveTz: deviceTimeZone(),
})

export const emptyFlight = (): FlightDraft => ({
  airline: '',
  booking_ref: '',
  outbound: emptyDirection(),
  return_flight: emptyDirection(),
})

const hasContent = (leg: LegDraft) => !!(leg.flight_no.trim() || leg.from.trim() || leg.to.trim())

/** True when nothing has been filled in — the form's "no flight" state. */
export const isDraftEmpty = (draft: FlightDraft): boolean =>
  !draft.airline.trim() &&
  !draft.booking_ref.trim() &&
  [draft.outbound, draft.return_flight].every(
    (d) => !d.legs.some(hasContent) && !d.departDate && !d.arriveDate
  )

/**
 * The one-line summary shown while the flight section is collapsed, or null
 * when there is nothing to summarise. Enough to recognise the booking without
 * opening it: the route end to end, and how many hops it takes.
 */
export function describeDraft(draft: FlightDraft): string | null {
  const filled = [draft.outbound, draft.return_flight].map((d) => d.legs.filter(hasContent))
  const [out, back] = filled
  if (!out.length && !back.length) {
    return draft.airline.trim() || draft.booking_ref.trim() || null
  }
  const route = (legs: LegDraft[]) => {
    if (!legs.length) return null
    const from = legs[0].from.trim() || legs[0].flight_no.trim()
    const to = legs[legs.length - 1].to.trim()
    const stops = legs.length > 1 ? ` · ${legs.length - 1} stop${legs.length > 2 ? 's' : ''}` : ''
    return to ? `${from} → ${to}${stops}` : `${from}${stops}`
  }
  return [route(out), route(back)].filter(Boolean).join('  ·  ')
}

function directionToDraft(itinerary: FlightItinerary | null | undefined): DirectionDraft {
  const base = emptyDirection()
  if (!itinerary) return base
  const depart = instantToZoned(itinerary.depart_at, itinerary.depart_tz)
  const arrive = instantToZoned(itinerary.arrive_at, itinerary.arrive_tz)
  return {
    legs: itinerary.legs?.length
      ? itinerary.legs.map((l) => ({ flight_no: l.flight_no, from: l.from, to: l.to }))
      : [emptyLeg()],
    departDate: depart.date,
    departTime: depart.time,
    departTz: itinerary.depart_tz || base.departTz,
    arriveDate: arrive.date,
    arriveTime: arrive.time,
    arriveTz: itinerary.arrive_tz || base.arriveTz,
  }
}

/** An existing booking, opened for editing. */
export function toDraft(flight: FlightInfo | null | undefined): FlightDraft {
  if (!flight) return emptyFlight()
  return {
    airline: flight.airline ?? '',
    booking_ref: flight.booking_ref ?? '',
    outbound: directionToDraft(flight.outbound),
    return_flight: directionToDraft(flight.return_flight),
  }
}

function directionFromDraft(draft: DirectionDraft): FlightItinerary | undefined {
  const legs: FlightLeg[] = draft.legs
    .filter(hasContent)
    .map((l) => ({ flight_no: l.flight_no.trim(), from: l.from.trim(), to: l.to.trim() }))
  // No leg, no direction. A stray time with nothing to attach it to is not a
  // flight, and storing one would render as a countdown to nowhere.
  if (!legs.length) return undefined
  const depart = zonedToInstant(draft.departDate, draft.departTime, draft.departTz)
  const arrive = zonedToInstant(draft.arriveDate, draft.arriveTime, draft.arriveTz)
  return {
    legs,
    ...(depart ? { depart_at: depart, depart_tz: draft.departTz } : {}),
    ...(arrive ? { arrive_at: arrive, arrive_tz: draft.arriveTz } : {}),
  }
}

/** What to send. `null` clears the booking; the server reads that as "no flight". */
export function fromDraft(draft: FlightDraft): FlightInfo | null {
  const outbound = directionFromDraft(draft.outbound)
  const returnFlight = directionFromDraft(draft.return_flight)
  if (!outbound && !returnFlight) return null
  return {
    ...(draft.airline.trim() ? { airline: draft.airline.trim() } : {}),
    ...(draft.booking_ref.trim() ? { booking_ref: draft.booking_ref.trim() } : {}),
    ...(outbound ? { outbound } : {}),
    ...(returnFlight ? { return_flight: returnFlight } : {}),
  }
}
