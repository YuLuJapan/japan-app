// Scheduling, on an activity's own screen.
//
// Before 010 this was "Add to a day", and it *created a second row* — an
// itinerary item pointing back at the place. There is one row now, so
// scheduling is a PATCH setting its date: the activity leaves its city's
// Explore list and appears on that day's plan. Clearing the date sends it
// back. The two directions are the same write, which is what makes the model
// honest rather than one-way.
//
// **Copy to another day** is the other half, and it is what FR-006 trades
// against: one activity has one date, so a second visit is a second row. The
// copy carries what makes it findable — category, address, coordinates, photo,
// description — and not what belongs to the original: its links (a reservation
// link is a reservation), its files or its tips. That is deliberately the same
// rule `specs/010-activities/migration.md` §3 applies to a place that was
// scheduled more than once, so the product and the migration cannot drift.
import { useMemo, useState } from 'react'
import { useTrip } from '../api/hooks'
import { useCreateActivity, useUpdateActivity } from '../api/mutations'
import type { Activity } from '../api/types'
import { enumerateDays, fmtDayLong, zoneDays } from '../lib/schedule'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'

export function ScheduleActivity({ activity }: { activity: Activity }) {
  const canEdit = useCanEdit()
  const tripId = useTripId()
  const trip = useTrip(tripId)
  const update = useUpdateActivity()
  const create = useCreateActivity()
  const [open, setOpen] = useState<'schedule' | 'copy' | null>(null)
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [done, setDone] = useState<string | null>(null)

  // The days this activity could sit on: the ones its city is visited on, or —
  // for one pinned to no city — every day of the trip.
  const days = useMemo(() => {
    if (!trip.data?.trip) return []
    const all = enumerateDays(trip.data.trip.start_date, trip.data.trip.end_date)
    return activity.zone_id ? zoneDays(trip.data.steps, activity.zone_id, all) : all
  }, [trip.data, activity.zone_id])

  if (!canEdit || !trip.data?.trip || days.length === 0) return null

  const chosen = day || days[0]
  const pending = update.isPending || create.isPending
  const failed = update.isError || create.isError

  const schedule = () =>
    update.mutate(
      { id: activity.id, patch: { day: chosen, start_time: time || null } },
      {
        onSuccess: () => {
          setDone(chosen)
          setOpen(null)
          setTime('')
        },
      }
    )

  const unschedule = () =>
    update.mutate({ id: activity.id, patch: { day: null } }, { onSuccess: () => setDone(null) })

  const copy = () =>
    create.mutate(
      {
        // What makes the copy findable travels; what belongs to the original
        // does not (see the note at the top).
        name: activity.name,
        zone_id: activity.zone_id,
        category: activity.category,
        description: activity.description,
        address: activity.address,
        image_url: activity.image_url ?? null,
        lat: activity.lat ?? null,
        lng: activity.lng ?? null,
        day: chosen,
        start_time: time || null,
      },
      {
        onSuccess: () => {
          setDone(chosen)
          setOpen(null)
          setTime('')
        },
      }
    )

  const picker = (submit: () => void, label: string) => (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        <select
          className="field flex-1"
          value={chosen}
          onChange={(e) => setDay(e.target.value)}
          aria-label="Day"
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {fmtDayLong(d)}
              {d === activity.day ? ' • already on this day' : ''}
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
      {failed && <p className="text-sm text-brand">Couldn't save — try again.</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : failed ? 'Retry' : label}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(null)}>
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <h2 className="section-title">Schedule</h2>
      {open === 'schedule' && picker(schedule, activity.day ? 'Move' : 'Schedule')}
      {open === 'copy' && picker(copy, 'Copy')}
      {open === null && (
        <div className="mt-2 space-y-2">
          {activity.day ? (
            <>
              <p className="text-sm text-muted">On {fmtDayLong(activity.day)}.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost flex-1"
                  onClick={() => setOpen('schedule')}
                >
                  Move to another day
                </button>
                <button type="button" className="btn-ghost flex-1" onClick={() => setOpen('copy')}>
                  Copy to another day
                </button>
              </div>
              <button
                type="button"
                className="btn-ghost w-full"
                onClick={unschedule}
                disabled={pending}
              >
                {pending ? 'Saving…' : 'Unschedule'}
              </button>
            </>
          ) : (
            <button type="button" className="btn-ghost w-full" onClick={() => setOpen('schedule')}>
              + Schedule this
            </button>
          )}
          {done && <p className="text-sm text-muted">Scheduled for {fmtDayLong(done)}. ✓</p>}
        </div>
      )}
    </div>
  )
}
