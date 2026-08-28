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

/** Tile width (150px) less the 10px the name is inset by on each side. */
const NAME_WIDTH = 130
/** Rough advance width of Bricolage Grotesque at 700, as a fraction of the size. */
const AVG_CHAR = 0.58
/** The design's size, and the smallest that still reads over a photo. */
const MAX_SIZE = 17
const MIN_SIZE = 11

/**
 * Type size for a city's name on its tile.
 *
 * The design draws every name at 17px, which is right for the names it was
 * drawn with — "Tokyo", "Hakone". A real trip has "Fujikawaguchiko", and at
 * 17px that is wider than the tile. It is also a single word, so no amount of
 * wrapping saves it: the size itself has to come down.
 *
 * Measured against the longest *word* rather than the whole string, because
 * that word is what cannot be broken; a multi-word name wraps to a second line
 * instead of shrinking. Short names are untouched, so the common tile still
 * matches the design exactly.
 */
export function nameSize(name: string): number {
  const longest = name.split(/\s+/).reduce((n, word) => Math.max(n, word.length), 0)
  if (!longest) return MAX_SIZE
  const fits = NAME_WIDTH / (longest * AVG_CHAR)
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor(fits)))
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
      // scroll-px-5 matches the px-5: with snapping on, the snapport is the
      // scrollport, which ignores padding — so the browser aligns the first
      // card's edge to the container edge and scrolls the padding away,
      // leaving card 1 cut off against the screen while every heading around
      // it stays indented. scroll-padding is what puts the padding back into
      // the snap geometry.
      className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pb-2"
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
              className="absolute bottom-2 left-2.5 right-2.5 line-clamp-2 font-display font-bold leading-[1.05] text-white"
              style={{
                fontSize: nameSize(zone?.name ?? ''),
                // Last resort behind nameSize: a name long enough to still
                // overflow at 11px breaks mid-word rather than running off
                // the tile.
                overflowWrap: 'anywhere',
                textShadow: '0 2px 8px rgba(0,0,0,.55)',
              }}
            >
              {zone?.name ?? 'Unknown'}
            </p>
          </Link>
        )
      })}
    </div>
  )
}
