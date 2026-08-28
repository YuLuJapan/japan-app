// The trip in space (redesign option 2c, "City chapters"): the whole trip is
// the default view, each stop drawn as one cluster sized by how much is saved
// there, and tapping a cluster opens that city's page.
//
// This is the *layout* the design specifies, driven by the trip's real data —
// stops, coordinates and saved-place counts. What it deliberately is not yet is
// a map: there are no tiles under it, so the clusters sit on the design's own
// hatched field rather than on streets. Slotting a real tile layer (Leaflet
// over OpenStreetMap is the choice that keeps this inside the free tiers)
// underneath `MapField` is the next step, and nothing above it has to change
// when that happens — the projection below already speaks in latitude and
// longitude.
import { Link } from 'react-router-dom'
import { useTrip } from '../api/hooks'
import type { TripStep } from '../api/types'
import { CATEGORIES } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { useTripId } from '../lib/trip'

/** Percentage box the clusters are laid inside, leaving room for their labels. */
const PAD = { left: 14, right: 14, top: 16, bottom: 26 }

const savedIn = (step: TripStep) =>
  step.zone ? CATEGORIES.reduce((n, c) => n + (step.zone!.place_counts[c] ?? 0), 0) : 0

/**
 * Where each stop sits, as a percentage of the field.
 *
 * Coordinates are projected linearly — over one country that is close enough to
 * a real projection to read correctly, and it is the arrangement that carries
 * the meaning here, not the metric distance. Two stops in the same city (or a
 * trip whose zones were never geocoded) would collapse onto one point, so a
 * degenerate axis falls back to spreading the stops evenly along it.
 */
export function projectStops(steps: TripStep[]): { x: number; y: number }[] {
  const pts = steps.map((s) => ({ lat: s.zone?.lat ?? null, lng: s.zone?.lng ?? null }))
  const lats = pts.map((p) => p.lat).filter((v): v is number => v != null)
  const lngs = pts.map((p) => p.lng).filter((v): v is number => v != null)
  const span = (vs: number[]) => {
    if (vs.length < 2) return null
    const lo = Math.min(...vs)
    const hi = Math.max(...vs)
    return hi - lo < 1e-6 ? null : { lo, hi }
  }
  const latSpan = span(lats)
  const lngSpan = span(lngs)

  return steps.map((_, i) => {
    const p = pts[i]
    // Evenly along the axis when there is nothing to project against. Serpentine
    // on the fallback y so a long trip doesn't stack every stop in one column.
    const even = steps.length > 1 ? i / (steps.length - 1) : 0.5
    const fx =
      lngSpan && p.lng != null
        ? (p.lng - lngSpan.lo) / (lngSpan.hi - lngSpan.lo)
        : (i % 2) * 0.6 + 0.2
    const fy =
      latSpan && p.lat != null ? 1 - (p.lat - latSpan.lo) / (latSpan.hi - latSpan.lo) : even
    return {
      x: PAD.left + fx * (100 - PAD.left - PAD.right),
      y: PAD.top + fy * (100 - PAD.top - PAD.bottom),
    }
  })
}

// Cycled per stop rather than tied to a category: a cluster stands for a whole
// city, so it has no one category to take its colour from. The order starts on
// ink so the first stop reads as the anchor, exactly as the design draws it.
const CLUSTER = [
  'bg-ink text-white',
  'bg-brand text-white',
  'bg-sight text-white',
  'bg-stay text-white',
  'bg-table text-white',
  'bg-market text-white',
]

export default function TripMap() {
  const tripId = useTripId()
  const { data, isPending, isError, refetch } = useTrip(tripId)

  if (isPending) return <Loading label="Loading the map…" />
  if (isError) return <ErrorState message="Could not load the trip." onRetry={() => refetch()} />

  const steps = data.steps.filter((s) => s.zone)
  const points = projectStops(steps)
  const title = data.trip.country ? `All of ${data.trip.country}` : 'The whole trip'

  return (
    <div className="-mx-5 -mt-1">
      <div
        className="relative h-[calc(100dvh-9.5rem)] min-h-[26rem] overflow-hidden bg-[#DCE4DD]"
        data-testid="map-field"
      >
        {/* The design's hatched field, standing in for tiles. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(0deg,rgba(0,0,0,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.03) 1px,transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />

        <div className="absolute left-4 right-4 top-4">
          <span className="inline-block rounded-xl bg-white/90 px-3 py-2 font-display text-lg font-extrabold text-ink backdrop-blur">
            {title}
          </span>
        </div>

        {steps.map((step, i) => {
          const saved = savedIn(step)
          // 44–56px, as the design sizes them: the busiest stop is the biggest
          // circle, and a stop with nothing saved still has to be tappable.
          const busiest = Math.max(1, ...steps.map(savedIn))
          const size = 44 + Math.round((saved / busiest) * 12)
          return (
            <Link
              key={step.id}
              to={`/trips/${tripId}/zones/${step.zone!.id}`}
              data-testid="map-cluster"
              className="absolute -translate-x-1/2 -translate-y-1/2 text-center active:scale-95"
              style={{ left: `${points[i].x}%`, top: `${points[i].y}%` }}
            >
              <span
                className={`mx-auto flex items-center justify-center rounded-full font-display font-extrabold shadow-pop ${CLUSTER[i % CLUSTER.length]}`}
                style={{ width: size, height: size, fontSize: 15 }}
              >
                {saved}
              </span>
              <span className="mt-1.5 inline-block rounded-lg bg-white/85 px-2 py-0.5 text-[11px] font-bold text-ink backdrop-blur">
                {step.zone!.name}
              </span>
            </Link>
          )
        })}

        <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-canvas p-4 shadow-pop">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-faint">
            {steps.length ? 'Tap a city to open its saved places' : 'No stops on this trip yet'}
          </p>
          <div className="no-scrollbar mt-2.5 flex gap-2 overflow-x-auto">
            {steps.map((step) => (
              <Link
                key={step.id}
                to={`/trips/${tripId}/zones/${step.zone!.id}`}
                className="min-w-[92px] flex-1 rounded-xl bg-white p-2.5 text-center shadow-card active:scale-[0.98]"
              >
                <span className="block truncate text-[13px] font-bold text-ink">
                  {step.zone!.name}
                </span>
                <span className="text-[10px] text-faint">{savedIn(step)} saved</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
