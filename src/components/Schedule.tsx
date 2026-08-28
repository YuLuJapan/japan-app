// Day-by-day schedule: a date strip + the selected day's plan. Used on the home
// screen (whole trip, shows the city per day) and on a city page (that city's
// days only). Selection defaults to today when it falls inside the range.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ItineraryItem, TripStep } from '../api/types'
import {
  coveringSteps,
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

  // An item pinned to a city belongs to that city; an unpinned one belongs to whichever
  // city the day touches — so on a moving day it shows on both pages rather than
  // disappearing from the one you're leaving.
  const belongsToZone = (i: ItineraryItem, d: string) =>
    i.zone_id === zoneId ||
    (i.zone_id == null && coveringSteps(steps, d).some((s) => s.zone?.id === zoneId))

  const dayHasItems = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const i of items) {
      if (mode === 'zone' && !belongsToZone(i, i.day)) continue
      map.set(i.day, true)
    }
    return (d: string) => map.get(d) ?? false
  }, [items, mode, zoneId, steps])

  const itemsForDay = items.filter((i) =>
    mode === 'zone' ? i.day === day && belongsToZone(i, day) : i.day === day
  )

  const newZoneId = mode === 'zone' ? (zoneId ?? null) : (primaryStep(steps, day)?.zone?.id ?? null)
  const zones = dayZones(steps, day)
  const moving = mode === 'zone' && zoneId ? movingDay(steps, zoneId, day) : null
  const isMovingDay = (d: string) =>
    mode === 'zone' && zoneId ? movingDay(steps, zoneId, d) !== null : isTravelDay(steps, d)
  const highlights = itemsForDay.filter((i) => i.highlight)
  const planItems = itemsForDay.filter((i) => !i.highlight)

  return (
    <div className="space-y-4">
      <DayStrip
        days={days}
        selected={day}
        onSelect={setSelected}
        today={today}
        hasItems={dayHasItems}
        isMoving={isMovingDay}
        // A city screen has less to say per day and sits under a shorter hero,
        // so its rail is drawn one size down (design option 1g).
        size={mode === 'zone' ? 'sm' : 'md'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display text-base font-bold tracking-tight">{fmtDayLong(day)}</p>
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
        {mode === 'trip' && isTravelDay(steps, day) && (
          <span className="chip bg-market-tint text-market">✈ Travel day</span>
        )}
        {/* On a city page the shared checkout/arrival day is easy to miss — say where
            the day goes, and link the other city so you can flip between the two. */}
        {moving && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="chip bg-market-tint text-market" data-testid="moving-day-chip">
              ✈ Moving day
            </span>
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
      <DayPlan key={day} day={day} items={planItems} zoneId={newZoneId} tripId={tripId} />
    </div>
  )
}
