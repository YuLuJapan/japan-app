// "Add to a day" on a place: drop this place onto one of the days you're in its
// city, optionally at a time. Creates an itinerary item linked to the place.
import { useMemo, useState } from 'react'
import { useItinerary, useTrip } from '../api/hooks'
import { useCreateItineraryItem } from '../api/mutations'
import type { Place } from '../api/types'
import { enumerateDays, fmtDayLong, zoneDays } from '../lib/schedule'

export function AddPlaceToDay({ place }: { place: Place }) {
  const trip = useTrip()
  const itinerary = useItinerary()
  const create = useCreateItineraryItem()
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [addedDay, setAddedDay] = useState<string | null>(null)

  const days = useMemo(() => {
    if (!trip.data?.trip) return []
    const all = enumerateDays(trip.data.trip.start_date, trip.data.trip.end_date)
    return zoneDays(trip.data.steps, place.zone_id, all)
  }, [trip.data, place.zone_id])

  if (!trip.data?.trip || days.length === 0) return null

  const alreadyOn = new Set(
    (itinerary.data?.items ?? []).filter((i) => i.place_id === place.id).map((i) => i.day)
  )

  const submit = () => {
    const chosen = day || days[0]
    create.mutate(
      {
        day: chosen,
        zone_id: place.zone_id,
        place_id: place.id,
        title: place.name,
        start_time: time || null,
      },
      {
        onSuccess: () => {
          setAddedDay(chosen)
          setOpen(false)
          setTime('')
        },
      }
    )
  }

  return (
    <div>
      <h2 className="section-title">Schedule</h2>
      {!open ? (
        <div className="mt-2 space-y-2">
          <button type="button" className="btn-ghost w-full" onClick={() => setOpen(true)}>
            + Add to a day
          </button>
          {addedDay && (
            <p className="text-sm text-muted">Added to {fmtDayLong(addedDay)}. ✓</p>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <select
              className="field flex-1"
              value={day || days[0]}
              onChange={(e) => setDay(e.target.value)}
              aria-label="Day"
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {fmtDayLong(d)}
                  {alreadyOn.has(d) ? ' • already added' : ''}
                </option>
              ))}
            </select>
            <input
              type="time"
              className="field w-28 shrink-0"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Time"
            />
          </div>
          {create.isError && <p className="text-sm text-brand">Couldn't add — try again.</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1" onClick={submit} disabled={create.isPending}>
              {create.isPending ? 'Adding…' : create.isError ? 'Retry' : 'Add to day'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
