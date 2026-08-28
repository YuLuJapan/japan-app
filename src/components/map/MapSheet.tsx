// The peeking bottom sheet: rounded top corners, a short centred grab handle,
// resting *above* the fixed nav rather than under it.
//
// **Two states only, peeking and expanded.** A sheet with a continuum of
// heights is a gesture surface, and this one has one job: carry the chips, the
// missing-count line and the card row where a thumb can reach them without
// covering the map.
//
// Expanded is also the offline state (FR-026, research R11): with no imagery
// the sheet takes the whole screen and the card row becomes a vertical list —
// 2b's arrangement, borrowed for the one state where the map genuinely cannot
// be the answer.
import type { ReactNode } from 'react'

export function MapSheet({
  expanded,
  onToggle,
  children,
}: {
  expanded: boolean
  /** Null makes the handle inert — offline, the sheet is not collapsible. */
  onToggle: (() => void) | null
  children: ReactNode
}) {
  return (
    <section
      aria-label="Saved places"
      className={`absolute inset-x-0 bottom-0 z-[500] flex flex-col rounded-t-3xl bg-canvas pt-2 shadow-pop ${
        // pb-24 clears the fixed bottom nav; the sheet rests on top of it
        // rather than being pushed above it, which is what "peeking" means.
        expanded ? 'top-0 overflow-y-auto pb-24' : 'pb-24'
      }`}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse the list' : 'Expand the list'}
          className="mx-auto mb-2 h-6 w-16 shrink-0 py-2"
        >
          <span className="block h-1.5 w-full rounded-full bg-line" />
        </button>
      ) : (
        <span aria-hidden="true" className="mx-auto mb-2 block h-1.5 w-16 rounded-full bg-line" />
      )}
      {children}
    </section>
  )
}
