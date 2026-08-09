// One rule, two entities: nothing on a trip may be planned before it starts or
// after it ends. Journey steps and itinerary items both pin their dates to the
// trip's own window (documented in contracts/api.md), and updateTrip only lets
// the window move once it knows what to do with whatever falls outside it — so
// the invariant holds both ways.
// Dates are plain ISO strings (YYYY-MM-DD) and compare correctly lexically.

export interface DateRange {
  start_date: string
  end_date: string
}

const MS_PER_DAY = 86_400_000
const at = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/** ISO date `n` days later (UTC arithmetic — no DST to trip over). */
export const addDays = (iso: string, n: number): string =>
  new Date(at(iso) + n * MS_PER_DAY).toISOString().slice(0, 10)

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((at(to) - at(from)) / MS_PER_DAY)

export const withinRange = (date: string, range: DateRange) =>
  date >= range.start_date && date <= range.end_date

export const rangeLabel = (range: DateRange) => `${range.start_date} – ${range.end_date}`

/** One validation message when `date` falls outside the trip, none when it fits. */
export function collectRangeErrors(field: string, date: string, trip: DateRange): string[] {
  if (withinRange(date, trip)) return []
  return [`${field} must fall within the trip's dates (${rangeLabel(trip)})`]
}
