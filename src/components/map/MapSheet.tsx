// The peeking bottom sheet: rounded top corners, a short centred grab handle,
// resting *above* the fixed nav rather than under it.
//
// **Two resting states, peeking and expanded — but the handle is a slider, not
// a switch.** A tap has no direction, so the one gesture that took the sheet to
// full height was also the only way back from a screen that had covered the
// map. Here the sheet's height follows the finger between the two states and
// then settles on one of them when it is lifted: dragged down it shrinks back
// to peeking, dragged up it fills the screen, and a drag can change its mind
// on the way without being lifted first. In between it is neither state, which
// is what makes it read as a sheet being pulled rather than a panel toggling.
//
// **The rest is why the drag needs measuring at all.** Peeking is the sheet's
// natural content height — the chips, the missing line and one card row — and
// there is no `auto` to interpolate towards, so the two ends are measured from
// the DOM at the moment the finger lands: the sheet's own height, and its
// container's. Between them the height is written in pixels; on release it
// goes back to being a class, so nothing is left pinned to a number that a
// rotated phone or a longer card row would make wrong.
//
// Expanded is also the offline state (FR-026, research R11): with no imagery
// the sheet takes the whole screen and the card row becomes a vertical list —
// 2b's arrangement, borrowed for the one state where the map genuinely cannot
// be the answer. There the handle is inert and nothing below runs.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'

/**
 * A drag this long settles in the direction it was going, wherever it stopped.
 *
 * Without it the sheet would snap to whichever end is nearer, and a deliberate
 * upward flick from a short peeking sheet — which never gets near the halfway
 * mark — would spring back and read as a dropped gesture.
 */
const FLICK_PX = 56

/** What peeking is worth when the sheet has never been measured collapsed. */
const ASSUMED_PEEK = 0.35

export function MapSheet({
  expanded,
  onExpandedChange,
  onPeekHeight,
  children,
}: {
  expanded: boolean
  /** Null makes the handle inert — offline, the sheet is not collapsible. */
  onExpandedChange: ((next: boolean) => void) | null
  /**
   * How tall the sheet is at rest, in CSS pixels — what the map is told it has
   * to frame and centre above (`MapInset`), and what the locate button sits on
   * top of. Reported only from a settled peeking sheet: during a drag it would
   * be a moving target, and expanded there is no map left to reframe.
   */
  onPeekHeight?: (height: number) => void
  children: ReactNode
}) {
  const sheet = useRef<HTMLElement | null>(null)
  // Where the drag began and how tall the sheet was then. Refs, not state:
  // these are read by the next pointer event, never rendered.
  const from = useRef<{ y: number; height: number } | null>(null)
  // The two ends of the slide, measured when the finger lands.
  const ends = useRef({ peek: 0, full: 0 })
  const reported = useRef<number | null>(null)
  // Null except mid-drag, when it is the height in pixels — the one state that
  // is neither of the two resting states.
  const [dragging, setDragging] = useState<number | null>(null)

  // The height the rest of the screen positions against. Measured after every
  // render because the content decides it (a filter that empties the card row
  // makes the sheet shorter), and passed on only when it actually changes.
  useEffect(() => {
    if (!onPeekHeight || expanded || dragging !== null || !sheet.current) return
    const height = Math.round(sheet.current.getBoundingClientRect().height)
    if (height === reported.current) return
    reported.current = height
    onPeekHeight(height)
  })

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!onExpandedChange || !sheet.current) return
    const height = sheet.current.getBoundingClientRect().height
    // The container is what "full" means: the map's own box, not the window,
    // so the sheet cannot be dragged up past the header.
    const full = sheet.current.offsetParent?.getBoundingClientRect().height ?? height
    ends.current = {
      // A sheet that has never rested collapsed has no measured peek — only
      // possible offline, where this never runs, so the fraction is a floor
      // rather than a guess anyone sees.
      peek: expanded ? (reported.current ?? Math.round(full * ASSUMED_PEEK)) : height,
      full,
    }
    from.current = { y: event.clientY, height }
    setDragging(height)
    // Guarded: jsdom has no pointer capture, and neither do some older engines.
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!from.current) return
    // Upwards is a smaller clientY and a taller sheet, hence the subtraction.
    const wanted = from.current.height - (event.clientY - from.current.y)
    const { peek, full } = ends.current
    setDragging(Math.min(Math.max(wanted, Math.min(peek, full)), full))
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    const began = from.current
    from.current = null
    if (began === null || dragging === null || !onExpandedChange) {
      setDragging(null)
      return
    }
    const travelled = dragging - began.height
    const { peek, full } = ends.current
    setDragging(null)
    onExpandedChange(
      Math.abs(travelled) >= FLICK_PX ? travelled > 0 : dragging >= (peek + full) / 2
    )
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
      ref={sheet}
      aria-label="Saved places"
      // Mid-drag the height is the finger's, so neither resting class applies:
      // `top-0` would fight the height, and a scrollbar would appear and vanish
      // as the sheet passed its own content's height.
      style={dragging === null ? undefined : { height: `${dragging}px` }}
      className={`absolute inset-x-0 bottom-0 z-[500] flex flex-col rounded-t-3xl bg-canvas pt-2 shadow-pop ${
        // pb-24 clears the fixed bottom nav, which paints over the sheet's
        // bottom strip — "peeking" is the sheet resting on top of the map, not
        // on top of the nav.
        dragging !== null
          ? 'overflow-hidden pb-24'
          : expanded
            ? 'top-0 overflow-y-auto pb-24'
            : 'pb-24'
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
          className="mx-auto mb-2 flex w-full shrink-0 cursor-grab touch-none select-none justify-center py-2 active:cursor-grabbing"
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
