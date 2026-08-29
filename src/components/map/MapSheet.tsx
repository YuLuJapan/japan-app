// The peeking bottom sheet: rounded top corners, a short centred grab handle,
// resting *above* the fixed nav rather than under it.
//
// **Two states only, peeking and expanded.** A sheet with a continuum of
// heights is a gesture surface, and this one has one job: carry the chips, the
// missing-count line and the card row where a thumb can reach them without
// covering the map.
//
// **The handle is dragged, never tapped.** A tap is a single undifferentiated
// event, so the same one that opened the sheet to full height was the only way
// back — and full height covers the map, which is the thing the traveller came
// for. A drag carries a direction: down shrinks the sheet back to peeking, up
// brings it to full height, and the gesture is the one every other bottom
// sheet on a phone already answers to. The state still flips at a threshold
// rather than following the finger pixel for pixel: two states is the design,
// and a height that lands wherever the thumb let go is the gesture surface
// this deliberately is not.
//
// Expanded is also the offline state (FR-026, research R11): with no imagery
// the sheet takes the whole screen and the card row becomes a vertical list —
// 2b's arrangement, borrowed for the one state where the map genuinely cannot
// be the answer.
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

/**
 * How far the finger travels before the sheet changes state, in CSS pixels.
 *
 * Short enough to feel like a flick rather than a haul, long enough that the
 * jitter of a thumb resting on the handle is not a gesture.
 */
const DRAG_THRESHOLD_PX = 28

export function MapSheet({
  expanded,
  onExpandedChange,
  children,
}: {
  expanded: boolean
  /** Null makes the handle inert — offline, the sheet is not collapsible. */
  onExpandedChange: ((next: boolean) => void) | null
  children: ReactNode
}) {
  // Where the current drag started, or null when no finger is down. A ref
  // rather than state: a drag in progress changes nothing on screen until it
  // crosses the threshold, and re-rendering the sheet on every pointer move
  // would fight the gesture it is trying to follow.
  const from = useRef<number | null>(null)

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!onExpandedChange) return
    from.current = event.clientY
    // Guarded: jsdom has no pointer capture, and neither do some older engines.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (from.current === null || !onExpandedChange) return
    const travelled = event.clientY - from.current
    if (travelled > DRAG_THRESHOLD_PX && expanded) onExpandedChange(false)
    else if (travelled < -DRAG_THRESHOLD_PX && !expanded) onExpandedChange(true)
    else return
    // Re-anchored on the flip, so one long drag can change its mind on the way
    // back without the finger having to be lifted first.
    from.current = event.clientY
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    from.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  // A finger has a direction; a keyboard has arrow keys. Same two answers, so
  // the sheet is not a gesture nobody without a touchscreen can make.
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onExpandedChange) return
    if (event.key === 'ArrowUp' && !expanded) onExpandedChange(true)
    else if (event.key === 'ArrowDown' && expanded) onExpandedChange(false)
    else return
    event.preventDefault()
  }

  return (
    <section
      aria-label="Saved places"
      className={`absolute inset-x-0 bottom-0 z-[500] flex flex-col rounded-t-3xl bg-canvas pt-2 shadow-pop ${
        // pb-24 clears the fixed bottom nav; the sheet rests on top of it
        // rather than being pushed above it, which is what "peeking" means.
        expanded ? 'top-0 overflow-y-auto pb-24' : 'pb-24'
      }`}
    >
      {onExpandedChange ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={expanded ? 'Drag down to shrink the list' : 'Drag up to expand the list'}
          tabIndex={0}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={key}
          // `touch-none` so the browser does not claim the drag as a scroll
          // before the handle has seen it; the full-width strip is the grab
          // area, because a 64px bar is a target a thumb misses.
          className="mx-auto mb-2 flex w-full shrink-0 cursor-grab touch-none justify-center py-2"
        >
          <span className="block h-1.5 w-16 rounded-full bg-line" />
        </div>
      ) : (
        <span aria-hidden="true" className="mx-auto mb-2 block h-1.5 w-16 rounded-full bg-line" />
      )}
      {children}
    </section>
  )
}
