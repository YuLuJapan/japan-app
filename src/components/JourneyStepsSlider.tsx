// Journey visualization (FR-005/FR-006): a horizontal, snap-scrolling slider of
// photo cards — one per stop, in order, numbered, with a "Now" badge on the
// current stop. Step status is computed from the device date; `today` is
// injectable for tests.
//
// The redesign (option 1e) makes these pure photo tiles: a number, the city's
// name, nothing else. The dates and nights that used to sit in a strip under
// each card are gone from here — they are on the city's own screen, and the
// day rail immediately below this slider is the better answer to "when".
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

export function JourneyStepsSlider({
  steps,
  today = new Date(),
  tripId,
}: {
  steps: TripStep[]
  today?: Date
  tripId: string
}) {
  return (
    <div
      // Inside the page gutter rather than bled to the edge with `-mx-5 px-5`.
      // Leading padding on a scroller only holds while it is at rest — scroll it
      // and the first tile runs to the screen edge — so the rail sits in the
      // gutter instead and clips there. Matches the design, whose journey row is
      // `padding:0 16px` with no bleed, and keeps the tiles on the same left
      // edge as "The journey" above them.
      className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
      data-testid="journey-slider"
    >
      {steps.map((step, i) => {
        const status = stepStatus(step, today)
        const zone = step.zone
        return (
          <Link
            key={step.id}
            to={zone ? `/trips/${tripId}/zones/${zone.id}` : '#'}
            data-status={status}
            className={`relative h-[120px] w-[150px] shrink-0 snap-start overflow-hidden rounded-[20px] transition ${
              // The design draws one state for these tiles; the trip has two.
              // A coral ring is the cheapest way to say "you are here" without
              // adding a second badge to a 150px card.
              status === 'current' ? 'ring-2 ring-brand ring-offset-2 ring-offset-canvas' : ''
            }`}
          >
            <ZoneImage
              src={zone?.image_url}
              alt={zone ? zone.name : ''}
              className="h-full w-full"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  'linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,0) 35%,rgba(0,0,0,.62) 100%)',
              }}
            />
            <span className="absolute left-2 top-2 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white text-[11px] font-bold text-ink">
              {i + 1}
            </span>
            {status === 'current' && (
              <span className="absolute right-2 top-2 rounded-full bg-brand px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white">
                Now
              </span>
            )}
            <p
              className="absolute bottom-2 left-2.5 right-2.5 truncate font-display text-[17px] font-bold text-white"
              style={{ textShadow: '0 2px 8px rgba(0,0,0,.55)' }}
            >
              {zone?.name ?? 'Unknown'}
            </p>
          </Link>
        )
      })}
    </div>
  )
}
