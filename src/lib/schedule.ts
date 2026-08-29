// Day-by-day helpers. Trip data has no per-day rows — a day's city is derived
// from the journey steps (hotel stays). Dates are plain ISO strings (YYYY-MM-DD)
// compared lexically; Date objects are only used for formatting and stepping.
import type { ItineraryItem, TripStep, ZoneSummary } from '../api/types'

/** Local calendar date of `d` as YYYY-MM-DD (not UTC — avoids off-by-one). */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const at = (iso: string) => new Date(`${iso}T00:00:00`)

/** Every date from start to end inclusive. */
export function enumerateDays(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const end = at(endISO)
  for (let d = at(startISO); d <= end; d.setDate(d.getDate() + 1)) out.push(toISODate(d))
  return out
}

/** Steps whose stay covers this day (checkout day counts for both neighbours). */
export function coveringSteps(steps: TripStep[], day: string): TripStep[] {
  return steps.filter((s) => s.start_date <= day && day <= s.end_date)
}

/**
 * The city a day "belongs to": the step you sleep in that night (day < end).
 * On a travel day that's the arrival city; on the trip's final day it's the last
 * stay. Null only when no step covers the day.
 */
export function primaryStep(steps: TripStep[], day: string): TripStep | null {
  const covering = coveringSteps(steps, day)
  if (covering.length === 0) return null
  const staying = covering.find((s) => day < s.end_date)
  if (staying) return staying
  return covering.reduce((a, b) => (a.end_date >= b.end_date ? a : b))
}

/** True when two different cities share this date (a travel/checkout day). */
export function isTravelDay(steps: TripStep[], day: string): boolean {
  const zones = new Set(coveringSteps(steps, day).map((s) => s.zone?.id))
  return zones.size > 1
}

/**
 * Every date this zone touches: its nights, plus the moving day it shares with the
 * neighbouring city (you're still here in the morning of a checkout day, and already
 * here on the afternoon of an arrival day). A moving day therefore appears on *both*
 * cities' pages — `movingDay` says which way it goes so the UI can flag it.
 */
export function zoneDays(steps: TripStep[], zoneId: string, allDays: string[]): string[] {
  return allDays.filter((d) => coveringSteps(steps, d).some((s) => s.zone?.id === zoneId))
}

/**
 * How `day` moves in or out of `zoneId`, or null when the day is spent wholly in this
 * city (or doesn't touch it at all). `from` is the city you arrive from, `to` the city
 * you leave for; a day that only passes through this one carries both.
 */
export function movingDay(
  steps: TripStep[],
  zoneId: string,
  day: string
): { from: ZoneSummary | null; to: ZoneSummary | null } | null {
  const covering = coveringSteps(steps, day)
  const mine = covering.filter((s) => s.zone?.id === zoneId)
  if (mine.length === 0) return null
  // Order by position, not by date: on a shared date the steps' dates are equal, so
  // journey order is the only thing that says which city comes first.
  const others = covering
    .filter((s) => s.zone && s.zone.id !== zoneId)
    .sort((a, b) => a.position - b.position)
  const first = Math.min(...mine.map((s) => s.position))
  const last = Math.max(...mine.map((s) => s.position))
  const before = others.filter((s) => s.position < first)
  const after = others.filter((s) => s.position > last)
  if (before.length === 0 && after.length === 0) return null
  return { from: before.at(-1)?.zone ?? null, to: after[0]?.zone ?? null }
}

/**
 * One band of a day's plan as it reads on a city page: this city's own half, or the
 * half pinned to a city the day is shared with.
 */
export interface DaySection {
  /** The other city these activities are pinned to; null for this city's own half. */
  zone: ZoneSummary | null
  /** Where that city falls relative to this one on the day; null for our own half. */
  direction: 'before' | 'after' | null
  items: ItineraryItem[]
}

/**
 * A day's activities split into the bands a city page shows them in, in the order the
 * day is lived: the city you arrived from, this city, the city you leave for.
 *
 * A moving day is planned in both cities — the morning is checkout, breakfast and the
 * last sight in the one you're leaving; the afternoon belongs to the next. Hiding the
 * other city's half left the page you were leaving from empty on its own last morning,
 * and showing it unlabelled would have claimed an afternoon in Hakone as a Tokyo one.
 * So it is shown, under the name of the city it is actually in.
 *
 * `items` must already be filtered to `day`. Bands with nothing in them are dropped,
 * so an ordinary day is one band and needs no heading.
 */
export function daySections(
  steps: TripStep[],
  zoneId: string,
  day: string,
  items: ItineraryItem[]
): DaySection[] {
  const covering = coveringSteps(steps, day)
  const mineSteps = covering.filter((s) => s.zone?.id === zoneId)
  // An item pinned to this city belongs to it; an unpinned one belongs to whichever
  // city the day touches, so it reads from both pages rather than neither.
  const mine = items.filter(
    (i) => i.zone_id === zoneId || (i.zone_id == null && mineSteps.length > 0)
  )
  const here: DaySection = { zone: null, direction: null, items: mine }
  if (mineSteps.length === 0) return [here]

  // Order by position, not by date: on a shared date the steps' dates are equal, so
  // journey order is the only thing that says which city comes first.
  const first = Math.min(...mineSteps.map((s) => s.position))
  const last = Math.max(...mineSteps.map((s) => s.position))
  const before: DaySection[] = []
  const after: DaySection[] = []
  const seen = new Set<string>()
  for (const s of [...covering].sort((a, b) => a.position - b.position)) {
    const zone = s.zone
    if (!zone || zone.id === zoneId || seen.has(zone.id)) continue
    seen.add(zone.id)
    const theirs = items.filter((i) => i.zone_id === zone.id)
    if (theirs.length === 0) continue
    if (s.position < first) before.push({ zone, direction: 'before', items: theirs })
    else if (s.position > last) after.push({ zone, direction: 'after', items: theirs })
  }
  return [...before, here, ...after]
}

export const weekdayLetter = (iso: string) =>
  at(iso).toLocaleDateString('en', { weekday: 'short' }).slice(0, 2)

export const dayNumber = (iso: string) => String(at(iso).getDate())

export const fmtDayLong = (iso: string) =>
  at(iso).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })

/** True when `b` is the calendar day right after `a` (used to spot gaps in a day list). */
export function isNextDay(a: string, b: string): boolean {
  const next = at(a)
  next.setDate(next.getDate() + 1)
  return toISODate(next) === b
}

/** Ordered, de-duplicated zones a day touches — used for "Tokyo → Hakone" labels. */
export function dayZones(steps: TripStep[], day: string): ZoneSummary[] {
  const seen = new Set<string>()
  const out: ZoneSummary[] = []
  for (const s of coveringSteps(steps, day)) {
    if (s.zone && !seen.has(s.zone.id)) {
      seen.add(s.zone.id)
      out.push(s.zone)
    }
  }
  return out
}
