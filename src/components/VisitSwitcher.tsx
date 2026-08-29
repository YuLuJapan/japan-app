import { Link } from 'react-router-dom'
import type { VisitInfo } from '../api/types'
import { formatRange } from '../lib/visit-label'

/**
 * "2nd of 2 stays in Tokyo" — plus a way to the other one.
 *
 * Renders **nothing at all** for a city visited once, which is every city on
 * every trip but the ones this feature exists for (FR-003). That is checked
 * here rather than at each call site so no screen can forget it.
 *
 * The page's own eyebrow already carries this visit's dates, so this does not
 * repeat them: what it adds is the fact that another stay exists and a way to
 * reach it. Without that a traveller looking at half their Tokyo places has no
 * reason to think the other half is anywhere.
 */
export function VisitSwitcher({
  tripId,
  cityName,
  visit,
}: {
  tripId: string
  cityName: string
  visit: VisitInfo | null | undefined
}) {
  if (!visit || visit.total <= 1) return null

  const ordinal = ['1st', '2nd', '3rd'][visit.ordinal - 1] ?? `${visit.ordinal}th`

  return (
    <section
      aria-label={`Stays in ${cityName}`}
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-2xl bg-sand px-3.5 py-2.5 text-[13px]"
    >
      <span className="font-semibold text-ink">
        {ordinal} of {visit.total} stays in {cityName}
      </span>
      <span className="text-muted">Each stay keeps its own places and notes.</span>
      <span className="flex flex-wrap gap-1.5">
        {visit.siblings.map((sibling) => (
          <Link
            key={sibling.zone_id}
            to={`/trips/${tripId}/zones/${sibling.zone_id}`}
            className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-ink shadow-card active:scale-95"
          >
            {sibling.start_date && sibling.end_date
              ? formatRange(sibling.start_date, sibling.end_date)
              : `${['1st', '2nd', '3rd'][sibling.ordinal - 1] ?? `${sibling.ordinal}th`} stay`}
          </Link>
        ))}
      </span>
    </section>
  )
}
