// Swipe a list row sideways to act on it: right to tick it off, left to delete.
// Hand-rolled rather than pulling in a gesture library — it's one pointer
// gesture and the project keeps its dependencies small.
//
// Two things it has to get right on a phone:
//   • vertical scrolling must still work, so a drag only starts once the finger
//     has clearly gone sideways (and `touch-action: pan-y` leaves the vertical
//     axis to the browser);
//   • a swipe must not also open the row's link, so the click that follows a
//     drag is swallowed.
import { useRef, useState, type ReactNode } from 'react'

const START_THRESHOLD = 12 // px of sideways movement before we take over
const ACTION_THRESHOLD = 88 // px held at release to fire the action
const MAX_PULL = 128

interface Props {
  children: ReactNode
  onSwipeRight: () => void
  onSwipeLeft: () => void
  rightLabel: string
  leftLabel: string
  disabled?: boolean
}

export function SwipeRow({
  children,
  onSwipeRight,
  onSwipeLeft,
  rightLabel,
  leftLabel,
  disabled = false,
}: Props) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const decided = useRef<'none' | 'horizontal' | 'vertical'>('none')
  const moved = useRef(false)

  const reset = () => {
    start.current = null
    decided.current = 'none'
    setDragging(false)
    setDx(0)
  }

  function onTouchStart(e: React.TouchEvent) {
    if (disabled) return
    const t = e.touches[0]
    if (!t) return
    start.current = { x: t.clientX, y: t.clientY }
    decided.current = 'none'
    moved.current = false
  }

  function onTouchMove(e: React.TouchEvent) {
    const origin = start.current
    const t = e.touches[0]
    if (!origin || !t || disabled) return
    const deltaX = t.clientX - origin.x
    const deltaY = t.clientY - origin.y

    if (decided.current === 'none') {
      if (Math.abs(deltaY) > START_THRESHOLD && Math.abs(deltaY) > Math.abs(deltaX)) {
        decided.current = 'vertical' // the user is scrolling; stay out of the way
        return
      }
      if (Math.abs(deltaX) > START_THRESHOLD) {
        decided.current = 'horizontal'
        setDragging(true)
      } else return
    }
    if (decided.current !== 'horizontal') return

    moved.current = true
    setDx(Math.max(-MAX_PULL, Math.min(MAX_PULL, deltaX)))
  }

  function onTouchEnd() {
    if (decided.current === 'horizontal') {
      if (dx >= ACTION_THRESHOLD) onSwipeRight()
      else if (dx <= -ACTION_THRESHOLD) onSwipeLeft()
    }
    reset()
  }

  // a swipe ends in a click on the row's link — swallow that one
  function onClickCapture(e: React.MouseEvent) {
    if (moved.current) {
      e.preventDefault()
      e.stopPropagation()
      moved.current = false
    }
  }

  const armedRight = dx >= ACTION_THRESHOLD
  const armedLeft = dx <= -ACTION_THRESHOLD

  return (
    <div className="relative overflow-hidden rounded-3xl" style={{ touchAction: 'pan-y' }}>
      {/* what the swipe will do, revealed under the row as it slides */}
      <div className="absolute inset-0 flex items-center justify-between" aria-hidden>
        <div
          className={`flex h-full items-center gap-2 px-5 font-bold text-white transition-colors ${
            armedRight ? 'bg-emerald-500' : 'bg-emerald-500/60'
          } ${dx > 0 ? '' : 'opacity-0'}`}
        >
          <span className="text-lg">✓</span>
          {rightLabel}
        </div>
        <div
          className={`flex h-full items-center gap-2 px-5 font-bold text-white transition-colors ${
            armedLeft ? 'bg-brand' : 'bg-brand/60'
          } ${dx < 0 ? '' : 'opacity-0'}`}
        >
          {leftLabel}
          <span className="text-lg">🗑</span>
        </div>
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={reset}
        onClickCapture={onClickCapture}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 180ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  )
}
