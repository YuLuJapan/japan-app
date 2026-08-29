// Day-by-day schedule: a date strip + the selected day's plan. Used on the home
// screen (whole trip, shows the city per day) and on a city page (that city's
// days only). Selection defaults to today when it falls inside the range.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ItineraryItem, TripStep } from '../api/types'
import {
  type DaySection,
  daySections,
  dayZones,
  fmtDayLong,
  isTravelDay,
  movingDay,
  primaryStep,
} from '../lib/schedule'
import { DayHighlights } from './DayHighlights'
import { DayPlan } from './DayPlan'
import { DayStrip } from './DayStrip'

interface Props {
  steps: TripStep[]
  items: ItineraryItem[]
  days: string[]
  today: string
  /** 'trip' shows the day's city; 'zone' is scoped to one city's days. */
  mode: 'trip' | 'zone'
  zoneId?: string
  tripId: string
}

export function Schedule({ steps, items, days, today, mode, zoneId, tripId }: Props) {
  const [selected, setSelected] = useState(() =>
    days.includes(today) ? today : (days[0] ?? today)
  )
  const day = days.includes(selected) ? selected : (days[0] ?? today)

  // A city page reads the day in bands — the city you came from, this city, the city
  // you leave for — so a moving day is readable from both ends of the move instead of
  // only from the one you arrive in. The trip screen has one band: the whole day.
  const dayItems = items.filter((i) => i.day === day)
  const sections: DaySection[] =
    mode === 'zone' && zoneId
      ? daySections(steps, zoneId, day, dayItems)
      : [{ zone: null, direction: null, items: dayItems }]
  const shown = sections.flatMap((s) => s.items)

  // Every activity belongs to a city. A city page knows which one — the one you are
  // looking at, whatever the date. The trip screen infers it from the journey, and
  // `primaryStep` ("the city you sleep in that night") is right every day but a moving
  // one, where it would silently stamp the morning you spend leaving with the city you
  // are flying into. So on a shared day the trip screen stops guessing and asks: it
  // offers the day's cities and the traveller says which one they mean.
  const newZoneId = mode === 'zone' ? (zoneId ?? null) : (primaryStep(steps, day)?.zone?.id ?? null)
  const zones = dayZones(steps, day)
  const zoneChoices = mode === 'trip' && isTravelDay(steps, day) ? zones : undefined
  const moving = mode === 'zone' && zoneId ? movingDay(steps, zoneId, day) : null
  const isMovingDay = (d: string) =>
    mode === 'zone' && zoneId ? movingDay(steps, zoneId, d) !== null : isTravelDay(steps, d)
  // A featured note flags the whole day, so it stays a banner whichever band it is
  // pinned to; only the plan is banded.
  const highlights = shown.filter((i) => i.highlight)
  const planSections = sections.map((s) => ({ ...s, items: s.items.filter((i) => !i.highlight) }))

  return (
    <div className="space-y-4">
      <DayStrip
        days={days}
        selected={day}
        onSelect={setSelected}
        today={today}
        isMoving={isMovingDay}
        // A city screen has less to say per day and sits under a shorter hero,
        // so its rail is drawn one size down (design option 1g).
        size={mode === 'zone' ? 'sm' : 'md'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display text-lg font-bold tracking-tight">{fmtDayLong(day)}</p>
        {mode === 'trip' &&
          zones.map((z, i) => (
            <span key={z.id} className="flex items-center gap-2">
              {i > 0 && <span className="text-muted">→</span>}
              <Link
                to={`/trips/${tripId}/zones/${z.id}`}
                className="chip bg-sand font-bold text-ink"
              >
                {z.name}
              </Link>
            </span>
          ))}
        {/* On a city page the shared checkout/arrival day is easy to miss — say where
            the day goes, and link the other city so you can flip between the two. */}
        {moving && (
          // No "Moving day" badge: the cities either side say it better than a
          // label does, and the day rail already rings the day dashed.
          <span className="flex flex-wrap items-center gap-2" data-testid="moving-day-cities">
            {moving.from && (
              <Link
                to={`/trips/${tripId}/zones/${moving.from.id}`}
                className="chip bg-sand font-bold text-ink"
              >
                {moving.from.name} →
              </Link>
            )}
            {moving.to && (
              <Link
                to={`/trips/${tripId}/zones/${moving.to.id}`}
                className="chip bg-sand font-bold text-ink"
              >
                → {moving.to.name}
              </Link>
            )}
          </span>
        )}
      </div>

      <DayHighlights day={day} highlights={highlights} zoneId={newZoneId} tripId={tripId} />

      {/* Keyed by day so switching days drops any half-open form or "moved" notice. */}
      <DayPlan
        key={day}
        day={day}
        sections={planSections}
        zoneId={newZoneId}
        zoneChoices={zoneChoices}
        tripId={tripId}
      />
    </div>
  )
}
