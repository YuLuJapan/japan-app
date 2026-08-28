// The floating bar over the map: search on the left, the scale on the right.
//
// Two decisions the render could not make (research R13):
//
// **The segments read `City` and `Trip`, not `Day` and `Trip`.** 2a's left
// segment says "Day", which in the design's own vocabulary means scoping pins
// to one date — 2b's day chips do exactly that. No requirement here asks for
// day-scoping; FR-008 defines the two scales as the current step's zone and the
// whole trip. Same control, same place, same styling; the word was describing a
// different feature.
//
// **The search field routes to the existing `/search`.** The render cannot say
// what "Search Japan…" searches, map-specific search is in no FR, and a field
// that does nothing is worse than one that does something adjacent. Accepted
// consequence: this screen offers two ways into search, since the app header
// already carries a magnifier.
import { Link } from 'react-router-dom'

export type MapScale = 'zone' | 'trip'

export function MapTopBar({
  tripId,
  scale,
  onScale,
  zoneName,
}: {
  tripId: string
  scale: MapScale
  onScale: (next: MapScale) => void
  /** What the city segment is currently showing, for the search placeholder. */
  zoneName: string | null
}) {
  const segment = (value: MapScale, label: string) => (
    <button
      type="button"
      onClick={() => onScale(value)}
      aria-pressed={scale === value}
      className={`min-h-11 rounded-full px-4 text-sm font-bold transition-colors ${
        scale === value ? 'bg-ink text-white' : 'bg-white text-ink'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex items-center gap-2 p-3">
      <Link
        to={`/trips/${tripId}/search`}
        className="pointer-events-auto flex min-h-11 flex-1 items-center gap-2 truncate rounded-full bg-white px-4 text-sm text-muted shadow-card"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span className="truncate">Search {zoneName ?? 'this trip'}…</span>
      </Link>
      {/* One pill holding two segments, so the pair reads as one control. */}
      <div className="pointer-events-auto flex shrink-0 overflow-hidden rounded-full bg-white p-0.5 shadow-card">
        {segment('zone', 'City')}
        {segment('trip', 'Trip')}
      </div>
    </div>
  )
}
