// How a visit is named on screen.
//
// A zone is one *visit* to a city (spec 011), so a trip that goes to Tokyo
// twice has two Tokyo pages. This is the only place the wording that tells
// them apart lives — the zone page, the journey cards, the breadcrumb, the
// search subtitle, the map chips and the export headings all read it, so none
// of them can word it differently.
//
// The server owns the arithmetic (`server/src/lib/visit.ts`: which visit this
// is, and which other ones exist); this owns only the words.

/** The shape the API's `visit` block delivers. Dates are null for a visit no
 *  longer on the journey — a stop was deleted and its content kept. */
export interface VisitInfo {
  start_date: string | null
  end_date: string | null
  ordinal: number
  total: number
}

const at = (iso: string) => new Date(`${iso}T00:00:00`)

const day = (iso: string) => at(iso).toLocaleDateString('en', { day: 'numeric' })
/** Month first, matching `fmtDayLong` and the journey editor's own dates. */
const monthDay = (iso: string) =>
  at(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })

const ORDINALS = ['1st', '2nd', '3rd']
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`

/**
 * What to call this visit, or `''` when there is nothing to say.
 *
 * **An empty string is the common case and the point.** A city visited once
 * has `total === 1`, so every surface renders no label, no chooser and no
 * "which Tokyo?" — which is what makes single-visit cities untouched by this
 * feature (FR-003) by construction rather than by a special case at each call
 * site. Callers should render nothing at all for `''`, not an empty element.
 *
 * With siblings, the dates are the label — they are what the traveller
 * actually distinguishes the two stays by ("the September one"). The ordinal
 * is the fallback for when dates cannot do it: two visits with the same dates
 * (a data error, or a half-finished edit), or a visit taken off the journey
 * that has no dates left at all. Falling back rather than always numbering
 * matters because "2nd visit" is only meaningful next to the 1st, whereas
 * "12–16 Oct" stands alone in a search result.
 */
export function visitLabel(visit: VisitInfo | null | undefined): string {
  if (!visit || visit.total <= 1) return ''
  const { start_date, end_date } = visit
  if (!start_date || !end_date) return `${ordinal(visit.ordinal)} visit`
  return formatRange(start_date, end_date)
}

/**
 * "Sep 19–25", "Sep 28 – Oct 3", "Oct 12".
 *
 * Month first, because that is how every other date in the app already reads
 * (`fmtDayLong`, and the journey editor's own labels) — a range that ordered
 * itself the other way would be the only one on the screen that did.
 *
 * The month is not repeated when both dates share one: the label sits in a
 * breadcrumb and on a chip, where it competes with the city's own name for
 * room, and "Sep 19 – Sep 25" says nothing more than "Sep 19–25".
 */
export function formatRange(startISO: string, endISO: string): string {
  if (startISO === endISO) return monthDay(startISO)
  const sameMonth = at(startISO).getMonth() === at(endISO).getMonth()
  return sameMonth
    ? `${monthDay(startISO)}–${day(endISO)}`
    : `${monthDay(startISO)} – ${monthDay(endISO)}`
}

/**
 * The city plus its visit, for somewhere the city's own name is not already on
 * screen — a search result, an export heading. Returns the name unchanged for
 * a city visited once, so nothing gains a suffix it does not need.
 */
export function visitTitle(cityName: string, visit: VisitInfo | null | undefined): string {
  const label = visitLabel(visit)
  return label ? `${cityName} · ${label}` : cityName
}
