// Horizontal, snap-scrolling strip of date chips (the schedule day picker).
// Selected day is filled; today gets a dot. Each chip shows weekday + day number.
import { Fragment, useEffect, useRef } from 'react'
import { dayNumber, isNextDay, weekdayLetter } from '../lib/schedule'

interface Props {
  days: string[]
  selected: string
  onSelect: (day: string) => void
  today?: string
  /** Show a dot on days that have at least one planned activity. */
  hasItems?: (day: string) => boolean
  /** Flag days you change city on, so a shared checkout/arrival day stands out. */
  isMoving?: (day: string) => boolean
}

export function DayStrip({ days, selected, onSelect, today, hasItems, isMoving }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Keep the selected chip in view when it changes (e.g. jump to today).
  // Scroll the strip itself rather than calling scrollIntoView — that would also
  // scroll the *page* down to the strip, so landing on the app would skip past
  // the header and journey cards straight to "Day by day".
  useEffect(() => {
    const strip = ref.current
    const el = strip?.querySelector<HTMLElement>('[data-selected="true"]')
    if (!strip || !el) return
    // Measure the chip against the strip's own box. `offsetLeft` is relative to
    // the nearest *positioned* ancestor — the strip isn't positioned, so on a
    // wide screen that's the centred page container and the value carries the
    // container's page offset. Scrolling by it skipped the strip several days
    // forward, so picking Sep 29 left the strip starting at Oct 2.
    const stripBox = strip.getBoundingClientRect()
    const elBox = el.getBoundingClientRect()
    const start = elBox.left - stripBox.left
    // Already fully in view: leave the strip alone so tapping a day doesn't
    // shuffle every other chip out from under the finger.
    if (start >= 0 && start + elBox.width <= strip.clientWidth) return
    const left = strip.scrollLeft + start - strip.clientWidth / 2 + elBox.width / 2
    const max = Math.max(0, strip.scrollWidth - strip.clientWidth)
    strip.scrollTo({ left: Math.min(Math.max(0, left), max) })
  }, [selected])

  return (
    <div
      ref={ref}
      className="no-scrollbar -mx-5 flex snap-x gap-2 overflow-x-auto px-5 py-1"
      data-testid="day-strip"
    >
      {days.map((day, i) => {
        const active = day === selected
        const isToday = day === today
        const moving = isMoving?.(day) ?? false
        // A zone's days aren't always consecutive (e.g. a return trip to a city
        // visited earlier) — mark the gap so it doesn't read as one unbroken stay.
        const gapBefore = i > 0 && !isNextDay(days[i - 1], day)
        return (
          <Fragment key={day}>
            {gapBefore && (
              <span
                aria-hidden="true"
                data-testid="day-strip-gap"
                className="mx-1 h-10 w-px shrink-0 self-center bg-line"
              />
            )}
            <button
              type="button"
              data-selected={active}
              data-today={isToday}
              aria-pressed={active}
              aria-label={moving ? `${day} (moving day)` : day}
              onClick={() => onSelect(day)}
              className={`relative flex h-16 w-[52px] shrink-0 snap-start flex-col items-center justify-center rounded-2xl border text-center transition ${
                active
                  ? 'border-brand bg-brand text-white shadow-card'
                  : moving
                    ? 'border-amber-300 bg-amber-50 text-ink active:scale-95'
                    : 'border-line bg-white text-ink active:scale-95'
              }`}
            >
              {moving && (
                <span
                  aria-hidden="true"
                  data-testid="day-strip-moving"
                  className={`absolute left-1.5 top-1 text-[10px] font-extrabold leading-none ${
                    active ? 'text-white/90' : 'text-amber-600'
                  }`}
                >
                  →
                </span>
              )}
              <span
                className={`text-[10px] font-bold uppercase ${active ? 'text-white/80' : 'text-muted'}`}
              >
                {weekdayLetter(day)}
              </span>
              <span className="text-lg font-extrabold leading-tight">{dayNumber(day)}</span>
              {hasItems?.(day) && (
                <span
                  className={`absolute bottom-1.5 h-1 w-1 rounded-full ${active ? 'bg-white' : 'bg-brand'}`}
                />
              )}
              {isToday && !active && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />
              )}
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
