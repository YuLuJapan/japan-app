// What a field is allowed into an export, and the pure projection that obeys it.
//
// This is the file the whole export feature is about. Everything else — the
// route, the service, the four writers — is plumbing around the tables below.
//
// **A field reaches an exported file only by being named here.** The policies
// are typed `Record<keyof Entity, ExportLevel>`, so adding a column to `Place`
// is a *compile error* until someone decides whether it travels (FR-010,
// FR-011). That guard is only real because `npm run typecheck` runs alongside
// `npm test`: Vitest transpiles types away without checking them, so without
// the script the requirement would be satisfied on paper and inert in
// practice. The second, weaker guard is a runtime assertion in
// `server/tests/export-view.test.ts` that a share place emits exactly
// `name`, `address`, `category` — it catches a stray spread or a mis-set entry,
// but it cannot see a field that only exists in the TypeScript interface.
//
// Note what is *not* in this file: files, shopping items, members, the flight,
// reminders. Per FR-004a those never enter an export at either level, so they
// have no policy at all rather than a policy set to `'never'` — a field nobody
// can classify is a field nobody can accidentally promote.
import type {
  Category,
  ItineraryItem,
  JourneyStep,
  Place,
  PlaceLink,
  Tip,
  Trip,
  Zone,
} from './datastore.js'
import { addDays } from './trip-dates.js'
import { displayTitle } from './trip-title.js'
import { isStay, type TripView } from './trip-view.js'

/** The two versions, and the only thing that decides what is in a file. */
export type ExportDetail = 'share' | 'full'

export const EXPORT_DETAILS: readonly ExportDetail[] = ['share', 'full'] as const

export const isExportDetail = (value: unknown): value is ExportDetail =>
  EXPORT_DETAILS.includes(value as ExportDetail)

/**
 * How far a field travels.
 *
 * - `share` — in both versions.
 * - `full`  — the full copy only.
 * - `json`  — identifiers. Emitted only into the machine-readable backup
 *             (US4), at either detail level, because that one exists to be
 *             read back rather than read. No readable writer ever asks for it.
 * - `never` — in nothing, at any level, for any caller.
 */
export type ExportLevel = 'share' | 'full' | 'json' | 'never'

/** What one call is emitting: the level asked for, and whether ids ride along. */
export interface Emission {
  detail: ExportDetail
  /** True only for the JSON backup writer. */
  ids: boolean
}

/** Does the policy admit this field into *this* emission? */
const admits = (level: ExportLevel, at: Emission): boolean =>
  level === 'share' ? true : level === 'full' ? at.detail === 'full' : level === 'json' && at.ids

/**
 * `summary_line` is derived rather than a column (lib/place-view.ts), so it
 * cannot be a `keyof Place` — and it is exactly the field most likely to be
 * added back by reflex, since every other place payload carries it. It is
 * named here anyway: it is the first 100 characters of the description, so it
 * carries whatever the description carries (FR-003).
 */
export const PLACE_FIELD_POLICY: Record<keyof Place | 'summary_line', ExportLevel> = {
  name: 'share',
  address: 'share',
  category: 'share',
  description: 'full', // the booking reference lives here — the reason share exists
  links: 'full', // a reservation link is a reservation
  id: 'json',
  zone_id: 'json',
  name_ja: 'never', // deferred with the CJK font work; see spec Assumptions
  image_url: 'never',
  lat: 'never',
  lng: 'never',
  summary_line: 'never',
}

export const ZONE_FIELD_POLICY: Record<keyof Zone, ExportLevel> = {
  name: 'share',
  summary: 'full',
  id: 'never', // the document expresses structure by nesting, not by id
  trip_id: 'never',
  // Plumbing, not trip content: which visits are the same city (spec 011).
  // A reader sees the two stays as two sections with their own dates, which
  // is the whole of what the key exists to arrange — the key itself says
  // nothing a traveller would want in a document.
  city_key: 'never',
  name_ja: 'never',
  image_url: 'never',
  lat: 'never',
  lng: 'never',
}

/**
 * `title` is derived too (lib/trip-title.ts) — it is what every screen calls
 * the trip, so it is what the file is called after. `name` is the raw
 * override behind it and is never emitted on its own.
 */
export const TRIP_FIELD_POLICY: Record<keyof Trip | 'title', ExportLevel> = {
  title: 'share',
  start_date: 'share',
  end_date: 'share',
  country: 'share',
  description: 'full',
  name: 'never', // reaches the file only through `title`
  flight: 'never', // FR-004a — out of *both* versions, for an owner too
  people: 'never', // FR-004a — member and traveller names are out
  local_currency: 'never',
  home_currencies: 'never',
  start_time: 'never',
  start_tz: 'never',
  id: 'never',
}

export const STEP_FIELD_POLICY: Record<keyof JourneyStep, ExportLevel> = {
  start_date: 'share',
  end_date: 'share',
  position: 'share', // as order, not as a printed number
  zone_id: 'never', // resolved into the nested zone
  id: 'never',
  trip_id: 'never',
}

export const TIP_FIELD_POLICY: Record<keyof Tip, ExportLevel> = {
  body: 'full',
  id: 'never', // a tip is nested under its parent
  zone_id: 'never',
  place_id: 'never',
}

export const ITINERARY_FIELD_POLICY: Record<keyof ItineraryItem, ExportLevel> = {
  day: 'full',
  start_time: 'full',
  title: 'full',
  note: 'full',
  position: 'full', // as order
  highlight: 'full',
  icon: 'full',
  // The traveller's own tag on an activity. Classified out for now rather than
  // promoted: it would need a field on ExportDayItem and a rendering decision in
  // all four writers, and the exported plan already names the linked place where
  // there is one. Nothing stops a later change making it 'full' — this is the
  // decision being recorded, not a limitation.
  category: 'never',
  place_id: 'never', // resolved to a place *name*, and only where visible
  id: 'never',
  trip_id: 'never',
  zone_id: 'never',
}

// --- the payload -------------------------------------------------------------
//
// Nested rather than flat: nesting is what the readable formats render, and it
// is what lets the structure survive without ids. Optional keys are **absent,
// not null** — a share payload must not carry an empty container a writer
// could render as a labelled, empty section.

export interface ExportPlace {
  name: string
  /** Always present; empty when the place has no address (FR-018, SC-008). */
  address: string
  category: Category
  description?: string
  links?: PlaceLink[]
  tips?: string[]
  /** JSON backup only. */
  id?: string
  /** JSON backup only. */
  zone_id?: string
}

export interface ExportZone {
  name: string
  summary?: string
  places: ExportPlace[]
  tips?: string[]
}

export interface ExportStep {
  start_date: string
  end_date: string
  zone: ExportZone
}

export interface ExportDayItem {
  start_time?: string
  title: string
  note?: string
  highlight: boolean
  icon?: string
  /** Absent where the place is one this caller may not see. */
  place_name?: string
}

export interface ExportDay {
  day: string
  /**
   * The city or cities this day touches, in journey order.
   *
   * Two of them is a moving day — the same rule the app's own day-by-day
   * screen uses (`coveringSteps` / `dayZones` in `src/lib/schedule.ts`), where
   * a step's last day and the next step's first day are the same date. A
   * printed plan without this says "6 Oct · 20:00 Ramen Bar" and leaves the
   * reader to work out which country they are in.
   *
   * Empty only for a day no step covers — a gap in the journey, which is a
   * real state and is shown as one rather than hidden.
   */
  zones: string[]
  /** Empty on a day with nothing planned. The day is still listed. */
  items: ExportDayItem[]
}

export interface ExportTrip {
  title: string
  start_date: string
  end_date: string
  country: string
  description?: string
}

export interface ExportStats {
  place_count: number
  /** FR-018: the gap is reported rather than shown as blank rows. */
  places_without_address: number
  day_count: number
  /**
   * Whether stays are in this file. A property of the export, not a hint about
   * any particular place — it is the one place the response admits a view was
   * applied at all.
   */
  included_stays: boolean
}

export interface ExportPayload {
  detail: ExportDetail
  generated_at: string
  trip: ExportTrip
  steps: ExportStep[]
  /** Full detail only; an empty array at share detail. */
  days: ExportDay[]
  stats: ExportStats
}

/** Everything the projection reads, as the store returned it. */
export interface ExportSource {
  trip: Trip
  /** In the store's journey order. The projection never re-sorts. */
  steps: JourneyStep[]
  zones: Zone[]
  places: Place[]
  tips: Tip[]
  itinerary: ItineraryItem[]
  /** Stamped by the caller so the projection stays pure. */
  generated_at: string
}

export interface ProjectOptions {
  detail: ExportDetail
  /** Only the JSON backup asks for identifiers. */
  ids?: boolean
}

/**
 * The trip, reduced.
 *
 * `view` comes first because the order of the two filters *is* the
 * requirement (FR-008, data-model §4): the caller's view is applied, and only
 * then the field policy. Reversed, a hidden stay would be cut down to a name
 * and an address and then exported — harmless-looking at share detail and a
 * straight leak at full.
 *
 * Pure: no store, no clock, no randomness. The same rows at the same detail
 * always produce the same payload (SC-006), which is what makes the table
 * tests in `server/tests/export-view.test.ts` worth anything.
 */
export function projectExport(
  view: TripView,
  source: ExportSource,
  { detail, ids = false }: ProjectOptions
): ExportPayload {
  const at: Emission = { detail, ids }

  // --- 1. the view -----------------------------------------------------------
  // A hidden stay takes its tips and its day-plan links with it. Nothing here
  // records what was dropped: the file never states what was withheld.
  const visiblePlaces = view.stays ? source.places : source.places.filter((p) => !isStay(p))
  const visiblePlaceIds = new Set(visiblePlaces.map((p) => p.id))
  const visibleTips = source.tips.filter((t) => !t.place_id || visiblePlaceIds.has(t.place_id))

  // --- 2. the field policy, and 3. the shape ---------------------------------
  const zonesById = new Map(source.zones.map((z) => [z.id, z]))
  const placesByZone = new Map<string, Place[]>()
  for (const place of visiblePlaces) {
    const bucket = placesByZone.get(place.zone_id)
    if (bucket) bucket.push(place)
    else placesByZone.set(place.zone_id, [place])
  }
  const tipsByZone = new Map<string, Tip[]>()
  const tipsByPlace = new Map<string, Tip[]>()
  for (const tip of visibleTips) {
    const [map, key] = tip.zone_id ? [tipsByZone, tip.zone_id] : [tipsByPlace, tip.place_id]
    if (!key) continue
    const bucket = map.get(key)
    if (bucket) bucket.push(tip)
    else map.set(key, [tip])
  }

  const steps: ExportStep[] = []
  let placeCount = 0
  let placesWithoutAddress = 0

  // One step, one zone, one set of places. This used to deduplicate by place
  // id, because a city visited twice was a single zone reached by two steps —
  // so Tokyo's places were rendered under both stays and counted twice. A zone
  // is now one *visit* (spec 011), which removes the double count along with
  // the double rendering, and the `counted` Set with it.
  for (const step of source.steps) {
    const zone = zonesById.get(step.zone_id)
    if (!zone) continue
    const zonePlaces = placesByZone.get(zone.id) ?? []
    for (const place of zonePlaces) {
      placeCount++
      if (!place.address?.trim()) placesWithoutAddress++
    }
    steps.push({
      // Both share-level, so both always travel; guarded anyway, because a
      // policy entry that changes nothing is a policy entry nobody trusts.
      ...(admits(STEP_FIELD_POLICY.start_date, at) && { start_date: step.start_date }),
      ...(admits(STEP_FIELD_POLICY.end_date, at) && { end_date: step.end_date }),
      zone: projectZone(zone, zonePlaces, tipsByZone, tipsByPlace, at),
    } as ExportStep)
  }

  const days =
    detail === 'full'
      ? projectDays(source.trip, source.steps, zonesById, source.itinerary, visiblePlaces, at)
      : []

  return {
    detail,
    generated_at: source.generated_at,
    trip: projectTrip(source.trip, at),
    steps,
    days,
    stats: {
      place_count: placeCount,
      places_without_address: placesWithoutAddress,
      // Days carrying something, not days listed: `days` is now the whole
      // trip, so the two are different numbers and this is the one that
      // answers "how much of this is actually planned".
      day_count: days.filter((d) => d.items.length).length,
      included_stays: view.stays,
    },
  }
}

/**
 * Each entity is assembled key by key, never by copying a row and deleting
 * from it (FR-010) — which is why the accumulator starts as a `Partial` and is
 * asserted at the end rather than being spread from the source row.
 */
function projectTrip(trip: Trip, at: Emission): ExportTrip {
  const out: Partial<ExportTrip> = {}
  if (admits(TRIP_FIELD_POLICY.title, at)) {
    // `memberNames` is deliberately not passed. `displayTitle` falls back to
    // the members' display names when nobody is listed under `people`, which
    // is right on screen and wrong in a file: FR-004a keeps member names out
    // of every export. An unnamed trip with no travellers listed therefore
    // exports as "Trip to Japan" rather than as somebody's name. Not passing
    // it is what makes that structural instead of a rule to remember.
    out.title = displayTitle({ name: trip.name, country: trip.country, people: trip.people })
  }
  if (admits(TRIP_FIELD_POLICY.start_date, at)) out.start_date = trip.start_date
  if (admits(TRIP_FIELD_POLICY.end_date, at)) out.end_date = trip.end_date
  if (admits(TRIP_FIELD_POLICY.country, at)) out.country = trip.country ?? ''
  if (admits(TRIP_FIELD_POLICY.description, at) && trip.description) {
    out.description = trip.description
  }
  return out as ExportTrip
}

function projectZone(
  zone: Zone,
  places: Place[],
  tipsByZone: Map<string, Tip[]>,
  tipsByPlace: Map<string, Tip[]>,
  at: Emission
): ExportZone {
  const out: Partial<ExportZone> = {}
  if (admits(ZONE_FIELD_POLICY.name, at)) out.name = zone.name
  if (admits(ZONE_FIELD_POLICY.summary, at) && zone.summary) out.summary = zone.summary
  // Present even when empty: a zone with nothing visible in it is an honest
  // empty section, not a missing one (spec edge case).
  out.places = places.map((p) => projectPlace(p, tipsByPlace.get(p.id) ?? [], at))
  const tips = bodies(tipsByZone.get(zone.id) ?? [], at)
  if (tips.length) out.tips = tips
  return out as ExportZone
}

function projectPlace(place: Place, tips: Tip[], at: Emission): ExportPlace {
  const out: Partial<ExportPlace> = {}
  if (admits(PLACE_FIELD_POLICY.name, at)) out.name = place.name
  // Always present, empty when missing: the count in `stats` is what reports
  // the gap, and a place with no address is still listed by name (SC-008).
  if (admits(PLACE_FIELD_POLICY.address, at)) out.address = place.address ?? ''
  if (admits(PLACE_FIELD_POLICY.category, at)) out.category = place.category
  if (admits(PLACE_FIELD_POLICY.description, at) && place.description) {
    out.description = place.description
  }
  if (admits(PLACE_FIELD_POLICY.links, at) && place.links.length) out.links = place.links
  if (admits(PLACE_FIELD_POLICY.id, at)) out.id = place.id
  if (admits(PLACE_FIELD_POLICY.zone_id, at)) out.zone_id = place.zone_id
  const bodyList = bodies(tips, at)
  if (bodyList.length) out.tips = bodyList
  return out as ExportPlace
}

/** A tip is only ever its body, and only in the full copy. */
const bodies = (tips: Tip[], at: Emission): string[] =>
  admits(TIP_FIELD_POLICY.body, at) ? tips.map((t) => t.body) : []

/**
 * The day plan: every day of the trip, in order, each with the city it is
 * spent in and whatever was planned for it.
 *
 * **Every day, not only the planned ones.** A day-by-day plan that silently
 * skips the days nobody typed into is a list of activities, not a plan — and
 * the gaps are exactly what a reader uses to decide what to do. The app's own
 * screen enumerates the trip's days for the same reason. `stats.day_count`
 * still counts only the days carrying something, so the number that answers
 * "how much of this is planned" is unchanged.
 *
 * Items keep the order the store returned them in (by day, then timed items,
 * then position) — the export does not re-sort.
 *
 * A row whose place this caller may not see keeps its own words and loses its
 * link, exactly as the itinerary service already treats `place_id`. Dropping
 * the row instead would leave a hole in the day that says something was there.
 */
function projectDays(
  trip: Trip,
  steps: JourneyStep[],
  zonesById: Map<string, Zone>,
  itinerary: ItineraryItem[],
  visible: Place[],
  at: Emission
): ExportDay[] {
  if (!admits(ITINERARY_FIELD_POLICY.day, at)) return []

  const nameById = new Map(visible.map((p) => [p.id, p.name]))
  const itemsByDay = new Map<string, ExportDayItem[]>()
  for (const item of itinerary) {
    const out: Partial<ExportDayItem> = {}
    if (admits(ITINERARY_FIELD_POLICY.title, at)) out.title = item.title
    if (admits(ITINERARY_FIELD_POLICY.start_time, at) && item.start_time) {
      out.start_time = item.start_time
    }
    if (admits(ITINERARY_FIELD_POLICY.note, at) && item.note) out.note = item.note
    if (admits(ITINERARY_FIELD_POLICY.highlight, at)) out.highlight = item.highlight
    if (admits(ITINERARY_FIELD_POLICY.icon, at) && item.icon) out.icon = item.icon
    const name = item.place_id ? nameById.get(item.place_id) : undefined
    if (name) out.place_name = name

    const bucket = itemsByDay.get(item.day)
    if (bucket) bucket.push(out as ExportDayItem)
    else itemsByDay.set(item.day, [out as ExportDayItem])
  }

  // The trip's own window, plus any day an item somehow sits outside it. The
  // range rule (lib/trip-dates.ts) means that second set is normally empty —
  // but an export that quietly dropped a stranded activity would be worse than
  // one that prints a day off the end.
  const days = new Set<string>(itemsByDay.keys())
  for (let day = trip.start_date; day <= trip.end_date; day = addDays(day, 1)) days.add(day)

  return [...days].sort().map((day) => ({
    day,
    zones: zonesOn(steps, zonesById, day, at),
    items: itemsByDay.get(day) ?? [],
  }))
}

/**
 * The cities a day touches, in journey order — one ordinarily, two on the day
 * you move. Mirrors `coveringSteps`/`dayZones` on the client, which is what
 * the app's day-by-day screen shows above each day.
 */
function zonesOn(
  steps: JourneyStep[],
  zonesById: Map<string, Zone>,
  day: string,
  at: Emission
): string[] {
  if (!admits(ZONE_FIELD_POLICY.name, at)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const step of steps) {
    if (step.start_date > day || day > step.end_date) continue
    const zone = zonesById.get(step.zone_id)
    if (!zone || seen.has(zone.id)) continue
    seen.add(zone.id)
    names.push(zone.name)
  }
  return names
}
