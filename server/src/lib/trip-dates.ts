// One rule, two entities: nothing on a trip may be planned before it starts or
// after it ends. Journey steps and itinerary items both pin their dates to the
// trip's own window (documented in contracts/api.md), and updateTrip refuses to
// shrink the window out from under them — so the invariant holds both ways.
// Dates are plain ISO strings (YYYY-MM-DD) and compare correctly lexically.

export interface DateRange {
  start_date: string
  end_date: string
}

export const withinRange = (date: string, range: DateRange) =>
  date >= range.start_date && date <= range.end_date

export const rangeLabel = (range: DateRange) => `${range.start_date} – ${range.end_date}`

/** One validation message when `date` falls outside the trip, none when it fits. */
export function collectRangeErrors(field: string, date: string, trip: DateRange): string[] {
  if (withinRange(date, trip)) return []
  return [`${field} must fall within the trip's dates (${rangeLabel(trip)})`]
}
