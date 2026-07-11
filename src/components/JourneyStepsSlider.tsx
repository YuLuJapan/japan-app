// Journey visualization (FR-005/FR-006): a horizontal, snap-scrolling slider of
// photo cards — one per stop, in order, with dates, nights, and a "Now" badge on
// the current stop. Step status is computed from the device date; `today` is
// injectable for tests.
import { Link } from 'react-router-dom'
import type { TripStep } from '../api/types'
import { ZoneImage } from './ZoneImage'

export type StepStatus = 'past' | 'current' | 'future'

export function stepStatus(step: TripStep, today: Date): StepStatus {
  const day = today.toISOString().slice(0, 10)
  if (day < step.start_date) return 'future'
  if (day > step.end_date) return 'past'
  return 'current'
}

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })

const nights = (a: string, b: string) =>
  Math.round((+new Date(`${b}T00:00:00`) - +new Date(`${a}T00:00:00`)) / 86_400_000)

export function JourneyStepsSlider({ steps, today = new Date() }: { steps: TripStep[]; today?: Date }) {
  return (
    <div
      className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2"
      data-testid="journey-slider"
    >
      {steps.map((step, i) => {
        const status = stepStatus(step, today)
        const zone = step.zone
        const n = nights(step.start_date, step.end_date)
        return (
          <Link
            key={step.id}
            to={zone ? `/zones/${zone.id}` : '#'}
            data-status={status}
            className={`relative w-[76%] shrink-0 snap-start overflow-hidden rounded-3xl bg-white shadow-card ring-1 transition ${
              status === 'current' ? 'ring-2 ring-brand' : 'ring-line'
            }`}
          >
            <div className="relative">
              <ZoneImage src={zone?.image_url} alt={zone ? `${zone.name}` : ''} className="h-44 w-full" />
              <span className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-xs font-extrabold text-ink shadow">
                {i + 1}
              </span>
              {status === 'current' && (
                <span className="absolute right-3 top-3 rounded-full bg-brand px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white shadow">
                  ● Now
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8">
                <p className="font-display text-xl font-extrabold text-white drop-shadow">{zone?.name ?? 'Unknown'}</p>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold text-ink">
                {fmt(step.start_date)} – {fmt(step.end_date)}
              </span>
              <span className="chip bg-canvas text-muted">
                {n} {n === 1 ? 'night' : 'nights'}
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
