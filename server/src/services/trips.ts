// Trips: the top-level "which journey is this" entity. GET /api/trips lists
// them all (the "Where to next?" screen); GET /api/trips/:tripId returns the
// full journey skeleton for one (steps + zones + flight + file count).
import type { DataStore, ItineraryItem, JourneyStep, Trip, TripInput } from '../lib/datastore.js'
import { normalizeTraveller } from '../lib/datastore.js'
import { assertTripAccess, roleForTrip, type AccessContext } from '../lib/access.js'
import { canDeleteTrip, canEditTrip } from '../lib/permissions.js'
import { forbidden, notFound, validation } from '../lib/errors.js'
import {
  DEFAULT_HOME_CURRENCIES,
  DEFAULT_LOCAL_CURRENCY,
  MAX_HOME_CURRENCIES,
  normalizeCurrency,
} from '../lib/currencies.js'
import { normalizeFlight, type FlightInfo, type FlightItinerary } from '../lib/flight.js'
import { displayTitle } from '../lib/trip-title.js'
import { stepView } from '../lib/step-view.js'
import { FULL_VIEW, type TripView } from '../lib/trip-view.js'
import type { DateRange } from '../lib/trip-dates.js'
import { addDays, daysBetween, rangeLabel, withinRange } from '../lib/trip-dates.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_MAX = 120
const COUNTRY_MAX = 80
const PERSON_MAX = 60
const PEOPLE_MAX = 12

/**
 * The caller's trips. A brand-new account gets an empty list rather than
 * everybody's — this one line is what makes open registration safe.
 */
/**
 * The title travels with every trip, computed here rather than in each client.
 *
 * Member names are only ever a fallback for a trip whose roster is empty: the
 * roster answers "who is going", membership answers "who can open the app",
 * and those differ the moment a trip is shared with a friend.
 */
export async function tripTitle(store: DataStore, trip: Trip): Promise<string> {
  let memberNames: string[] = []
  if (!trip.people.some((p) => p.name.trim())) {
    const members = await store.listTripMembers(trip.id)
    const profiles = await Promise.all(members.map((m) => store.getProfile(m.user_id)))
    memberNames = profiles.map((p) => p?.display_name ?? '').filter(Boolean)
  }
  return displayTitle({ ...trip, memberNames })
}

async function withTitle(store: DataStore, trip: Trip) {
  return { ...trip, display_title: await tripTitle(store, trip) }
}

export async function listTrips(store: DataStore, access: AccessContext) {
  const rows = await store.listTripsForUser(access.userId)
  const trips = await Promise.all(rows.map((t) => withTitle(store, t)))
  return { trips }
}

/**
 * What this caller is shown here. A restricted view drops both extras the
 * bundle would otherwise carry: the flight (its booking reference and ticket
 * numbers) and the stay counts that would put a "Stays" card on every city.
 * See lib/trip-view.ts.
 */
export async function getTripBundle(
  store: DataStore,
  access: AccessContext,
  tripId: string,
  view: TripView = FULL_VIEW
) {
  const { flight: includeFlight, stays: includeStays } = view
  // 404 rather than 403 for a trip that isn't yours: a 403 would confirm it
  // exists to someone with no business knowing that.
  assertTripAccess(access, tripId)
  const trip = await store.getTrip(tripId)
  if (!trip) throw notFound('Trip')
  const steps = await store.listSteps(trip.id)
  const stepsWithZones = await Promise.all(
    steps.map((step) => stepView(store, trip.id, step, { includeStays }))
  )
  const trip_files_count = await store.countTripFiles(trip.id)
  return {
    trip: await withTitle(store, trip),
    steps: stepsWithZones,
    trip_files_count,
    // What this caller may do here, and what they are shown. The frontend uses
    // both to decide which buttons to offer and how to explain an absence — a
    // hidden category should read as "not shared with you", not as "empty".
    // Neither is ever what decides whether a request succeeds.
    my_role: roleForTrip(access, trip.id),
    shows: view,
    // Absent for a trip with no booking attached and for a caller who may not
    // see it — the client renders the same "no flights yet" card either way,
    // and it has no business telling them apart.
    ...(includeFlight && trip.flight ? { flight: trip.flight } : {}),
  }
}

function cleanPeople(people: unknown[] | undefined) {
  if (people === undefined) return undefined
  return people
    .map(normalizeTraveller)
    .map((p) => ({ name: p.name.trim(), ...(p.email ? { email: p.email.trim() } : {}) }))
    .filter((p) => p.name)
}

/** Uppercased, de-duplicated — the shape the store and the calculator expect. */
function cleanHomeCurrencies(codes: string[] | undefined): string[] | undefined {
  if (codes === undefined) return undefined
  return [...new Set(codes.map((c) => normalizeCurrency(c)).filter((c): c is string => !!c))]
}

const FLIGHT_NO_MAX = 16
const AIRPORT_MAX = 80
const AIRLINE_MAX = 60
const BOOKING_REF_MAX = 24
/** Enough for the worst realistic routing; a guard against an unbounded array. */
const MAX_LEGS = 8

/** True for an IANA zone this runtime actually knows — the browser sends it. */
function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * One direction of a booking. `legs` is the substance — two or more legs *are*
 * a connection, which is why this needs no separate notion of one.
 *
 * Times are optional and validated in pairs: an instant without its zone would
 * render in whichever zone the reader's phone is in, which is exactly what the
 * stored zones exist to prevent.
 */
function collectItineraryErrors(value: unknown, label: string): string[] {
  const errors: string[] = []
  if (value === null || value === undefined) return errors
  if (typeof value !== 'object' || Array.isArray(value)) {
    return [`flight.${label} must be an object`]
  }
  const itinerary = value as Record<string, unknown>
  const legs = itinerary.legs
  if (!Array.isArray(legs)) return [`flight.${label}.legs must be an array`]
  if (legs.length > MAX_LEGS) errors.push(`flight.${label} must have at most ${MAX_LEGS} legs`)
  legs.forEach((leg, i) => {
    const at = `flight.${label}.legs[${i}]`
    if (!leg || typeof leg !== 'object') {
      errors.push(`${at} must be an object`)
      return
    }
    const { flight_no: no, from, to } = leg as Record<string, unknown>
    // A leg with no flight number is the one thing this feature exists to
    // record, so it is the one thing required.
    if (typeof no !== 'string' || !no.trim()) errors.push(`${at}.flight_no is required`)
    else if (no.trim().length > FLIGHT_NO_MAX)
      errors.push(`${at}.flight_no must be at most ${FLIGHT_NO_MAX} characters`)
    for (const [key, airport] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (airport === undefined || airport === null || airport === '') continue
      if (typeof airport !== 'string') errors.push(`${at}.${key} must be text`)
      else if (airport.trim().length > AIRPORT_MAX)
        errors.push(`${at}.${key} must be at most ${AIRPORT_MAX} characters`)
    }
  })
  for (const key of ['depart', 'arrive'] as const) {
    const instant = itinerary[`${key}_at`]
    const zone = itinerary[`${key}_tz`]
    if (instant === undefined || instant === null || instant === '') continue
    if (typeof instant !== 'string' || Number.isNaN(Date.parse(instant)))
      errors.push(`flight.${label}.${key}_at must be an ISO instant`)
    if (typeof zone !== 'string' || !zone)
      errors.push(
        `flight.${label}.${key}_at needs ${key}_tz — a time without its zone is ambiguous`
      )
    else if (!isKnownTimeZone(zone))
      errors.push(`flight.${label}.${key}_tz must be an IANA time zone`)
  }
  return errors
}

function collectFlightErrors(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (typeof value !== 'object' || Array.isArray(value)) return ['flight must be an object or null']
  const flight = value as Record<string, unknown>
  const errors = [
    ...collectItineraryErrors(flight.outbound, 'outbound'),
    ...collectItineraryErrors(flight.return_flight, 'return_flight'),
  ]
  for (const [key, max] of [
    ['airline', AIRLINE_MAX],
    ['booking_ref', BOOKING_REF_MAX],
  ] as const) {
    const field = flight[key]
    if (field === undefined || field === null || field === '') continue
    if (typeof field !== 'string') errors.push(`flight.${key} must be text`)
    else if (field.trim().length > max)
      errors.push(`flight.${key} must be at most ${max} characters`)
  }
  return errors
}

/** Trim the strings and drop the empties, then re-run the reader's own rules. */
function cleanFlight(value: FlightInfo | null | undefined): FlightInfo | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const direction = (itinerary: FlightItinerary | null | undefined) => {
    if (!itinerary) return undefined
    const legs = (itinerary.legs ?? [])
      .map((leg) => ({
        flight_no: leg.flight_no?.trim() ?? '',
        from: leg.from?.trim() ?? '',
        to: leg.to?.trim() ?? '',
      }))
      .filter((leg) => leg.flight_no || leg.from || leg.to)
    return { ...itinerary, legs }
  }
  // normalizeFlight is the reader's rule; running it here means what is stored
  // is exactly what will be read back, rather than something that survives the
  // write and then silently vanishes on the way out.
  return normalizeFlight({
    airline: value.airline?.trim(),
    booking_ref: value.booking_ref?.trim(),
    outbound: direction(value.outbound),
    return_flight: direction(value.return_flight),
  })
}

function collectTripErrors(input: Partial<TripInput>, partial: boolean): string[] {
  const errors: string[] = []
  const has = (k: keyof TripInput) => input[k] !== undefined

  // The name is an override now, not the title — an empty one means "build it
  // from who is going and where" (lib/trip-title.ts), so it is never required.
  if (has('name') && input.name != null) {
    const name = input.name.trim()
    if (name.length > NAME_MAX) errors.push(`name must be at most ${NAME_MAX} characters`)
  }
  if (has('country') && input.country != null) {
    const country = input.country.trim()
    if (country.length > COUNTRY_MAX)
      errors.push(`country must be at most ${COUNTRY_MAX} characters`)
  }
  if (!partial || has('start_date')) {
    if (!input.start_date || !DATE_RE.test(input.start_date))
      errors.push('start_date must be an ISO date (YYYY-MM-DD)')
  }
  if (!partial || has('end_date')) {
    if (!input.end_date || !DATE_RE.test(input.end_date))
      errors.push('end_date must be an ISO date (YYYY-MM-DD)')
  }
  if (
    input.start_date &&
    input.end_date &&
    DATE_RE.test(input.start_date) &&
    DATE_RE.test(input.end_date) &&
    input.end_date < input.start_date
  ) {
    errors.push('end_date must be on or after start_date')
  }
  if (has('flight')) errors.push(...collectFlightErrors(input.flight))
  // The pair rule again: a wall-clock time without its zone means one instant
  // while packing at home and another after landing, so the countdown would
  // jump when the phone changed zone.
  if (has('start_time') && input.start_time != null) {
    // Hours and minutes, not just two digits and a colon: "25:00" would sail
    // through a looser shape and then silently roll the countdown into the
    // next day.
    if (typeof input.start_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.start_time))
      errors.push('start_time must be HH:MM')
    else if (!input.start_tz) errors.push('start_time needs start_tz')
  }
  if (has('start_tz') && input.start_tz != null) {
    if (typeof input.start_tz !== 'string' || !isKnownTimeZone(input.start_tz))
      errors.push('start_tz must be an IANA time zone')
  }
  if (has('local_currency') && input.local_currency != null) {
    if (!normalizeCurrency(input.local_currency))
      errors.push('local_currency must be a supported 3-letter currency code')
  }
  if (has('home_currencies') && input.home_currencies != null) {
    const codes = input.home_currencies
    if (!Array.isArray(codes)) errors.push('home_currencies must be an array of currency codes')
    else if (!codes.length) errors.push('home_currencies must list at least one currency')
    else if (codes.length > MAX_HOME_CURRENCIES)
      errors.push(`home_currencies must list at most ${MAX_HOME_CURRENCIES} currencies`)
    else if (codes.some((c) => !normalizeCurrency(c)))
      errors.push('home_currencies must be supported 3-letter currency codes')
  }
  if (has('description') && input.description != null && input.description.length > 2000)
    errors.push('description must be at most 2000 characters')
  if (has('people') && input.people != null) {
    if (!Array.isArray(input.people)) errors.push('people must be an array of travellers')
    else if (input.people.length > PEOPLE_MAX) {
      errors.push(`people must have at most ${PEOPLE_MAX} travellers`)
    } else {
      const travellers = input.people.map(normalizeTraveller)
      if (travellers.some((p) => !p.name.trim())) errors.push('each traveller needs a name')
      else if (travellers.some((p) => p.name.trim().length > PERSON_MAX))
        errors.push(`each traveller's name must be at most ${PERSON_MAX} characters`)
      if (travellers.some((p) => p.email && !EMAIL_RE.test(p.email)))
        errors.push('each traveller email must be a valid email address')
    }
  }
  return errors
}

/**
 * Steps and activities are pinned to the trip's dates on the way in, so moving
 * or shortening those dates afterwards is the one move that could strand them.
 * `GET /api/trips/:tripId/date-impact` runs this before the traveller commits,
 * so the sheet can list exactly what is in the way.
 *
 * Both can be resolved from here, and both have to be: a stop's dates are
 * themselves pinned to the trip, so "fix the stop first, then the dates" is a
 * deadlock — the stop cannot leave the old window and the window cannot move
 * while the stop is in it. Postponing a trip was impossible until this could
 * move the stops along with it.
 */
async function findStranded(store: DataStore, tripId: string, range: DateRange) {
  const [steps, items] = await Promise.all([store.listSteps(tripId), store.listItinerary(tripId)])
  return {
    steps: steps.filter(
      (s) => !withinRange(s.start_date, range) || !withinRange(s.end_date, range)
    ),
    items: items.filter((i) => !withinRange(i.day, range)),
  }
}

function strandedStepsError(steps: JourneyStep[], range: DateRange): string[] {
  if (!steps.length) return []
  const dates = steps.map((s) => `${s.start_date} – ${s.end_date}`).join(', ')
  return [
    steps.length === 1
      ? `A journey stop (${dates}) falls outside ${rangeLabel(range)} — say what to do with it (stranded_stops)`
      : `${steps.length} journey stops (${dates}) fall outside ${rangeLabel(range)} — say what to do with them (stranded_stops)`,
  ]
}

/**
 * A stop moved onto the trip's first day, keeping its length. The stay is
 * clipped when the trip is now too short to hold it — a 4-night stop on a
 * 2-day trip becomes a 2-day one rather than hanging off the end again.
 */
function movedStepDates(step: JourneyStep, range: DateRange) {
  const nights = daysBetween(step.start_date, step.end_date)
  const end = addDays(range.start_date, nights)
  return {
    start_date: range.start_date,
    end_date: end > range.end_date ? range.end_date : end,
  }
}

function strandedItemsError(items: ItineraryItem[], range: DateRange): string[] {
  if (!items.length) return []
  const days = [...new Set(items.map((i) => i.day))].sort()
  return [
    days.length === 1
      ? `Activities are planned on ${days[0]}, outside ${rangeLabel(range)} — move or remove them first`
      : `Activities are planned on ${days.length} days (${days.join(', ')}) outside ${rangeLabel(range)} — move or remove them first`,
  ]
}

/** The merged range a date patch would produce, validated. */
async function resolveRange(
  store: DataStore,
  tripId: string,
  patch: { start_date?: string; end_date?: string }
): Promise<DateRange> {
  const current = await store.getTrip(tripId)
  if (!current) throw notFound('Trip')
  const range = {
    start_date: patch.start_date ?? current.start_date,
    end_date: patch.end_date ?? current.end_date,
  }
  if (range.end_date < range.start_date)
    throw validation(['end_date must be on or after start_date'])
  return range
}

/**
 * What changing the dates to `range` would strand — asked by the trip sheet
 * before it saves, so the traveller sees the actual stops and activities
 * rather than a bare error, and picks what happens to them.
 */
export async function getDateImpact(
  store: DataStore,
  access: AccessContext,
  tripId: string,
  query: { start_date?: string; end_date?: string }
) {
  assertTripAccess(access, tripId)
  const errors: string[] = []
  if (query.start_date !== undefined && !DATE_RE.test(query.start_date))
    errors.push('start_date must be an ISO date (YYYY-MM-DD)')
  if (query.end_date !== undefined && !DATE_RE.test(query.end_date))
    errors.push('end_date must be an ISO date (YYYY-MM-DD)')
  if (errors.length) throw validation(errors)

  const range = await resolveRange(store, tripId, query)
  const stranded = await findStranded(store, tripId, range)
  const zoneNames = await Promise.all(
    stranded.steps.map(async (s) => (await store.getZone(tripId, s.zone_id))?.name ?? null)
  )
  return {
    range,
    steps: stranded.steps.map((s, i) => ({
      id: s.id,
      start_date: s.start_date,
      end_date: s.end_date,
      zone_name: zoneNames[i],
      // Where `stranded_stops: "move"` would put it. Sent so the client shows
      // the actual outcome — including a stay clipped short by a trip that no
      // longer has room for it — rather than re-deriving the rule and drifting.
      moves_to: movedStepDates(s, range),
    })),
    items: stranded.items.map((i) => ({
      id: i.id,
      day: i.day,
      start_time: i.start_time,
      title: i.title,
      highlight: i.highlight,
    })),
  }
}

export async function createTrip(
  store: DataStore,
  access: AccessContext,
  input: Partial<TripInput>
) {
  const errors = collectTripErrors(input, false)
  if (errors.length) throw validation(errors)
  const trip = await store.createTrip({
    name: input.name?.trim() || null,
    country: input.country?.trim() || null,
    start_date: input.start_date!,
    end_date: input.end_date!,
    description: input.description?.trim() || null,
    people: cleanPeople(input.people) ?? [],
    // Unset means the pair the calculator always had, so an old client that
    // doesn't know about currencies still creates a usable trip.
    local_currency: normalizeCurrency(input.local_currency) ?? DEFAULT_LOCAL_CURRENCY,
    home_currencies: cleanHomeCurrencies(input.home_currencies) ?? [...DEFAULT_HOME_CURRENCIES],
    flight: cleanFlight(input.flight) ?? null,
    start_time: input.start_time ?? null,
    start_tz: input.start_tz ?? null,
  })
  // Whoever creates a trip owns it. Without this the trip would have no
  // members at all, which makes it invisible to everyone including its author
  // — the "every trip keeps at least one owner" invariant starts here.
  await store.upsertTripMember({ trip_id: trip.id, user_id: access.userId, role: 'owner' })
  return { trip: await withTitle(store, trip), my_role: 'owner' }
}

/** What to do with activities the new dates would leave outside the trip. */
export const STRANDED_RESOLUTIONS = ['move', 'delete'] as const
export type StrandedResolution = (typeof STRANDED_RESOLUTIONS)[number]

/**
 * Stops only move. Deleting one rearranges the journey and already lives on the
 * journey editor behind its own confirmation, so it is not offered as a side
 * effect of a date change.
 */
export const STOP_RESOLUTIONS = ['move'] as const
export type StopResolution = (typeof STOP_RESOLUTIONS)[number]

export interface TripPatch extends Partial<TripInput> {
  /** Required (by the client's choice) only when the date change strands activities. */
  stranded_activities?: StrandedResolution
  /** Required only when the date change strands journey stops. */
  stranded_stops?: StopResolution
}

export async function updateTrip(
  store: DataStore,
  access: AccessContext,
  tripId: string,
  patch: TripPatch
) {
  assertTripAccess(access, tripId)
  const role = roleForTrip(access, tripId)
  // A member who lacks the verb gets 403, not 404 — they already know the trip
  // exists, so there is nothing left to conceal.
  if (!role || !canEditTrip(role)) throw forbidden('Only the travellers on this trip can edit it')
  const { stranded_activities: resolution, stranded_stops: stopResolution, ...fields } = patch
  const errors = collectTripErrors(fields, true)
  if (resolution !== undefined && !STRANDED_RESOLUTIONS.includes(resolution))
    errors.push(`stranded_activities must be one of: ${STRANDED_RESOLUTIONS.join(', ')}`)
  if (stopResolution !== undefined && !STOP_RESOLUTIONS.includes(stopResolution))
    errors.push(`stranded_stops must be one of: ${STOP_RESOLUTIONS.join(', ')}`)
  if (errors.length) throw validation(errors)

  const datesChanged = fields.start_date !== undefined || fields.end_date !== undefined
  let strandedSteps: JourneyStep[] = []
  let strandedItems: ItineraryItem[] = []
  let range: DateRange | null = null

  if (datesChanged) {
    range = await resolveRange(store, tripId, fields)
    const stranded = await findStranded(store, tripId, range)
    // Both kinds need an explicit choice; with none, this stays the refusal it
    // was before the sheet learned to ask.
    if (stranded.steps.length && !stopResolution)
      throw validation(strandedStepsError(stranded.steps, range))
    if (stranded.items.length && !resolution)
      throw validation(strandedItemsError(stranded.items, range))
    strandedSteps = stranded.steps
    strandedItems = stranded.items
  }

  const clean: Partial<TripInput> = { ...fields }
  // An emptied field clears the override rather than storing "".
  if (clean.name !== undefined) clean.name = clean.name?.trim() || null
  if (clean.country !== undefined) clean.country = clean.country?.trim() || null
  if (clean.description !== undefined) clean.description = clean.description?.trim() || null
  if (clean.people !== undefined) clean.people = cleanPeople(clean.people)
  if (clean.local_currency !== undefined)
    clean.local_currency = normalizeCurrency(clean.local_currency) ?? DEFAULT_LOCAL_CURRENCY
  if (clean.home_currencies !== undefined)
    clean.home_currencies = cleanHomeCurrencies(clean.home_currencies)
  const trip = await store.updateTrip(tripId, clean)
  if (!trip) throw notFound('Trip')

  // The trip lands first, then what was stranded follows it. There is no
  // transaction across the two (the DataStore has none), so the order matters:
  // if the second half fails the dates are already correct and re-saving them
  // with the same choices retries the move/delete.
  const movedStops: string[] = []
  const moved: string[] = []
  const deleted: string[] = []
  if (range) {
    for (const step of strandedSteps) {
      await store.updateStep(tripId, step.id, movedStepDates(step, range))
      movedStops.push(step.id)
    }
    for (const item of strandedItems) {
      if (resolution === 'delete') {
        await store.deleteItineraryItem(tripId, item.id)
        deleted.push(item.id)
      } else {
        await store.updateItineraryItem(tripId, item.id, { day: range.start_date })
        moved.push(item.id)
      }
    }
  }

  return {
    trip: await withTitle(store, trip),
    ...(movedStops.length && { moved_stops: movedStops }),
    ...(moved.length && { moved }),
    ...(deleted.length && { deleted }),
  }
}

export async function deleteTrip(store: DataStore, access: AccessContext, tripId: string) {
  assertTripAccess(access, tripId)
  const role = roleForTrip(access, tripId)
  if (!role || !canDeleteTrip(role)) throw forbidden('Only an owner can delete this trip')
  const ok = await store.deleteTrip(tripId)
  if (!ok) throw notFound('Trip')
}

export type { Trip }
