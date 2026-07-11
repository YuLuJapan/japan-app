// Day-by-day helpers. Trip data has no per-day rows — a day's city is derived
// from the journey steps (hotel stays). Dates are plain ISO strings (YYYY-MM-DD)
// compared lexically; Date objects are only used for formatting and stepping.
import type { TripStep, ZoneSummary } from '../api/types'

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

/** The dates whose primary city is this zone (its nights + a final-day stay). */
export function zoneDays(steps: TripStep[], zoneId: string, allDays: string[]): string[] {
  return allDays.filter((d) => primaryStep(steps, d)?.zone?.id === zoneId)
}

export const weekdayLetter = (iso: string) =>
  at(iso).toLocaleDateString('en', { weekday: 'short' }).slice(0, 2)

export const dayNumber = (iso: string) => String(at(iso).getDate())

export const fmtDayLong = (iso: string) =>
  at(iso).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })

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
