// The way in: a circle of colour with a spark in it.
//
// It carries no word, which is the point — a labelled pill competes with the
// screen's own buttons for attention and reads as one more thing to do, while
// a round mark in a corner reads as something that is always there. The label
// lives in `aria-label`, so nothing is lost to a screen reader.
//
// The gradient is the one deliberate exception to "reuse the design tokens":
// the palette here is warm sand and coral, and a token-coloured circle would
// disappear into it. This is meant to be the brightest thing on the screen,
// because it is the only control that is on *every* screen. It is defined once
// as `.ask-orb` in `styles/index.css` rather than inline, so the animation and
// the reduced-motion rule live with the rest of the app's motion.
export function AskOrb({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Ask about this trip"
      className={`ask-orb flex h-14 w-14 items-center justify-center rounded-full text-white shadow-pop transition-transform active:scale-95 ${className}`}
    >
      <SparkMark />
    </button>
  )
}

/**
 * Four-point sparks — one large, two small.
 *
 * `relative` matters: the gradient is painted by a `::before` layer inside the
 * button, so anything meant to sit on top of it needs a stacking position of
 * its own or it is covered by its own background.
 */
function SparkMark() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className="relative drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
    >
      {/* A star drawn from four concave curves, so the points stay sharp at
          26px where a polygon's would blunt. */}
      <path d="M13.4 2.6c.2 3.3.9 5.2 2.2 6.5 1.3 1.3 3.2 2 6.5 2.2-3.3.2-5.2.9-6.5 2.2-1.3 1.3-2 3.2-2.2 6.5-.2-3.3-.9-5.2-2.2-6.5-1.3-1.3-3.2-2-6.5-2.2 3.3-.2 5.2-.9 6.5-2.2 1.3-1.3 2-3.2 2.2-6.5Z" />
      <path d="M5.6 14.8c.1 1.5.4 2.4 1 3s1.5.9 3 1c-1.5.1-2.4.4-3 1s-.9 1.5-1 3c-.1-1.5-.4-2.4-1-3s-1.5-.9-3-1c1.5-.1 2.4-.4 3-1s.9-1.5 1-3Z" />
      <path d="M18.9 16.4c.1 1 .3 1.6.7 2 .4.4 1 .6 2 .7-1 .1-1.6.3-2 .7-.4.4-.6 1-.7 2-.1-1-.3-1.6-.7-2-.4-.4-1-.6-2-.7 1-.1 1.6-.3 2-.7.4-.4.6-1 .7-2Z" />
    </svg>
  )
}
