// Horizontal, snap-scrolling strip of date circles (the schedule day picker).
//
// The redesign (options 1e/1g) draws these as rings rather than filled tiles:
// a 46px circle carrying the day number, the weekday beneath it in small caps,
// and — on a day you change city — a plane above a dashed coral ring. The
// selected day takes a thicker coral ring and a blush fill; today, when it
// isn't the selected day, gets a coral dot so "jump to today" has something to
// aim at.
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
  /** 46px on the trip screen, 42px on a city's own. */
  size?: 'md' | 'sm'
}

export function DayStrip({
  days,
  selected,
  onSelect,
  today,
  hasItems,
  isMoving,
  size = 'md',
}: Props) {
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

  const circle = size === 'md' ? 'h-[46px] w-[46px]' : 'h-[42px] w-[42px]'

  return (
    <div
      ref={ref}
      // scroll-px-5 pairs with the px-5 — see the note in JourneyStepsSlider:
      // without it the snap geometry ignores the padding and the first chip
      // ends up flush against the screen edge, out of line with everything
      // above it.
      className="no-scrollbar -mx-5 flex snap-x gap-2.5 overflow-x-auto scroll-px-5 px-5 py-1"
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
                className="mx-0.5 h-10 w-px shrink-0 self-center bg-line"
              />
            )}
            <button
              type="button"
              data-selected={active}
              data-today={isToday}
              aria-pressed={active}
              aria-label={moving ? `${day} (moving day)` : day}
              onClick={() => onSelect(day)}
              className="flex shrink-0 snap-start flex-col items-center gap-1.5 active:scale-95"
            >
              {/* Reserved whether or not the plane is there, so the circles in a
                  row stay on one baseline. */}
              <span
                aria-hidden="true"
                data-testid={moving ? 'day-strip-moving' : undefined}
                className="h-[11px] text-[11px] font-bold leading-none text-brand"
              >
                {moving ? '✈' : ''}
              </span>
              <span
                className={`relative flex items-center justify-center rounded-full font-display text-sm font-bold transition ${circle} ${
                  active
                    ? 'border-[2.5px] border-brand bg-blush text-ink'
                    : moving
                      ? 'border-2 border-dashed border-brand text-brand'
                      : 'border-2 border-stone text-slate'
                }`}
              >
                {dayNumber(day)}
                {hasItems?.(day) && (
                  <span
                    className={`absolute -bottom-0.5 h-1 w-1 rounded-full ${active ? 'bg-brand' : 'bg-dust'}`}
                  />
                )}
                {isToday && !active && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-brand ring-2 ring-canvas" />
                )}
              </span>
              <span
                className={`text-[9px] font-bold uppercase ${moving && !active ? 'text-brand' : 'text-faint'}`}
              >
                {weekdayLetter(day)}
              </span>
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
