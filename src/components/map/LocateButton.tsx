// The small circular control that asks where the traveller is.
//
// Not in the 2a render — US2 needs it and the render has no slot for it (plan
// → departure 4). It borrows `MapLegend`'s floating idiom (white, rounded,
// shadowed, over the map) so it reads as part of the same family rather than
// as a new species of control.
//
// **Nothing asks for a position until this is tapped** (FR-023). That is why
// the control exists at all rather than the map simply knowing.
import type { PositionState } from '../../lib/geolocation'

export function LocateButton({
  state,
  onLocate,
  bottom,
}: {
  state: PositionState
  onLocate: () => void
  /**
   * How far above the map's bottom edge to float, in CSS pixels — the sheet's
   * own height plus a gap. A fixed offset put this behind the sheet, which is
   * taller than any constant worth writing and changes with the card row.
   */
  bottom: number
}) {
  const asking = state.status === 'asking'
  return (
    <button
      type="button"
      onClick={onLocate}
      disabled={asking}
      aria-label={state.status === 'granted' ? 'Go to my position' : 'Show my position'}
      style={{ bottom }}
      className="absolute right-3 z-[500] flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink shadow-card active:scale-95 disabled:opacity-60"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
        className={asking ? 'animate-pulse' : undefined}
      >
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" />
      </svg>
    </button>
  )
}
