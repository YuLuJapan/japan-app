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
}

export function DayStrip({ days, selected, onSelect, today, hasItems }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // keep the selected chip in view when it changes (e.g. jump to today)
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-selected="true"]')
    el?.scrollIntoView({ inline: 'center', block: 'nearest' })
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
              aria-label={day}
              onClick={() => onSelect(day)}
              className={`relative flex h-16 w-12 shrink-0 snap-start flex-col items-center justify-center rounded-2xl border text-center transition ${
                active
                  ? 'border-brand bg-brand text-white shadow-card'
                  : 'border-line bg-white text-ink active:scale-95'
              }`}
            >
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
