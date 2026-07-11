// Day-by-day schedule: a date strip + the selected day's plan. Used on the home
// screen (whole trip, shows the city per day) and on a city page (that city's
// days only). Selection defaults to today when it falls inside the range.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ItineraryItem, TripStep } from '../api/types'
import { dayZones, fmtDayLong, isTravelDay, primaryStep } from '../lib/schedule'
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
}

export function Schedule({ steps, items, days, today, mode, zoneId }: Props) {
  const [selected, setSelected] = useState(() =>
    days.includes(today) ? today : (days[0] ?? today)
  )
  const day = days.includes(selected) ? selected : (days[0] ?? today)

  const belongsToZone = (i: ItineraryItem, d: string) =>
    i.zone_id === zoneId || (i.zone_id == null && primaryStep(steps, d)?.zone?.id === zoneId)

  const dayHasItems = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const i of items) {
      if (mode === 'zone' && !belongsToZone(i, i.day)) continue
      map.set(i.day, true)
    }
    return (d: string) => map.get(d) ?? false
  }, [items, mode, zoneId])

  const itemsForDay = items.filter((i) =>
    mode === 'zone' ? i.day === day && belongsToZone(i, day) : i.day === day
  )

  const newZoneId = mode === 'zone' ? (zoneId ?? null) : (primaryStep(steps, day)?.zone?.id ?? null)
  const zones = dayZones(steps, day)

  return (
    <div className="space-y-4">
      <DayStrip days={days} selected={day} onSelect={setSelected} today={today} hasItems={dayHasItems} />

      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display text-lg font-extrabold">{fmtDayLong(day)}</p>
        {mode === 'trip' &&
          zones.map((z, i) => (
            <span key={z.id} className="flex items-center gap-2">
              {i > 0 && <span className="text-muted">→</span>}
              <Link to={`/zones/${z.id}`} className="chip bg-canvas font-bold text-ink">
                {z.name}
              </Link>
            </span>
          ))}
        {mode === 'trip' && isTravelDay(steps, day) && (
          <span className="chip bg-amber-100 text-amber-700">Travel day</span>
        )}
      </div>

      <DayPlan day={day} items={itemsForDay} zoneId={newZoneId} />
    </div>
  )
}
