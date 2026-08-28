// One day's activities, drawn as the redesign's timeline (option 1g): a
// hairline down the left with a dot per activity, the time in a fixed column
// so titles align, and the linked place's category and attachments as tags
// underneath. Inline add / edit / delete; deletes are confirmed. Times are
// optional — timed items sort ahead of "anytime" ones (server order).
//
// The first activity of a day takes the coral dot and coral time; the rest are
// muted. That is the design's own emphasis, and it reads as "this is where the
// day starts" without needing to know anything about the clock.
//
// Editing an activity can also move it to another day, so a plan that shifts by
// a day is a date change rather than a delete-and-retype. The picker is bounded
// by the trip's own dates — the same rule the API enforces.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTrip } from '../api/hooks'
import {
  useCreateItineraryItem,
  useDeleteItineraryItem,
  useUpdateItineraryItem,
} from '../api/mutations'
import { CATEGORY_META, type ItineraryItem } from '../api/types'
import { saveErrorMessage } from '../lib/errors'
import { fmtDayLong } from '../lib/schedule'
import { useCanEdit } from '../lib/session'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'

/** "09:00" → "9:00 AM"; blank when no time. */
export function fmtTime(hhmm: string | null): string {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':')
  const H = Number(h)
  const ap = H < 12 ? 'AM' : 'PM'
  const h12 = ((H + 11) % 12) + 1
  return `${h12}:${m} ${ap}`
}

interface Props {
  day: string
  items: ItineraryItem[]
  /** City this day belongs to; new items are tagged with it. */
  zoneId?: string | null
  tripId: string
}

export function DayPlan({ day, items, zoneId = null, tripId }: Props) {
  const canEdit = useCanEdit()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // An activity moved to another day leaves this list, so say where it went.
  const [movedTo, setMovedTo] = useState<string | null>(null)

  const trip = useTrip(tripId)
  const tripRange = trip.data?.trip
    ? { start: trip.data.trip.start_date, end: trip.data.trip.end_date }
    : null
  const create = useCreateItineraryItem(tripId)
  const update = useUpdateItineraryItem()
  const remove = useDeleteItineraryItem()

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="section-title">Plan</h3>
        {canEdit && !adding && (
          <button
            type="button"
            className="text-sm font-bold text-brand"
            onClick={() => setAdding(true)}
          >
            + Add activity
          </button>
        )}
      </div>

      {movedTo && <p className="mb-2 text-sm text-muted">Moved to {fmtDayLong(movedTo)}. ✓</p>}

      {items.length === 0 && !adding ? (
        <EmptyState message="Nothing planned for this day yet." />
      ) : (
        <ol className="relative ml-[18px] border-l border-line pl-[18px]">
          {items.map((item, i) =>
            editingId === item.id ? (
              <li key={item.id} className="mb-2 rounded-2xl border border-line bg-white p-3">
                <ItemForm
                  initial={item}
                  day={day}
                  tripRange={tripRange}
                  pending={update.isPending}
                  error={update.error}
                  submitLabel="Save"
                  onCancel={() => setEditingId(null)}
                  onSubmit={(patch) =>
                    update.mutate(
                      { id: item.id, patch },
                      {
                        onSuccess: () => {
                          setEditingId(null)
                          setMovedTo(patch.day && patch.day !== day ? patch.day : null)
                        },
                      }
                    )
                  }
                />
              </li>
            ) : (
              <li key={item.id} className="relative pb-5 last:pb-0">
                <span
                  aria-hidden
                  className={`absolute -left-[18px] top-[7px] h-2 w-2 rounded-full ${
                    i === 0 ? 'bg-brand' : 'bg-dust'
                  }`}
                />
                <div className="flex items-baseline gap-3">
                  <span
                    className={`w-14 shrink-0 text-[11px] ${
                      i === 0 ? 'font-bold text-brand' : 'font-semibold text-faint'
                    }`}
                  >
                    {item.start_time ? fmtTime(item.start_time) : 'Anytime'}
                  </span>
                  <p className="min-w-0 flex-1 text-sm font-bold leading-snug text-ink">
                    {item.title}
                  </p>
                </div>
                <div className="ml-[68px]">
                  {item.note && (
                    <p className="mt-1 text-[11px] leading-relaxed text-[#8A8478]">{item.note}</p>
                  )}
                  {(item.place_category || item.place_files?.length) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {item.place_category && (
                        <span
                          className={`rounded-full px-2 py-[3px] text-[10px] font-bold ${
                            CATEGORY_META[item.place_category].color
                          }`}
                        >
                          {CATEGORY_META[item.place_category].icon}{' '}
                          {CATEGORY_META[item.place_category].label}
                        </span>
                      )}
                      {item.place_files?.map((name) => (
                        <span
                          key={name}
                          className="max-w-[160px] truncate rounded-full bg-sand px-2 py-[3px] text-[10px] font-semibold text-slate"
                        >
                          📎 {name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-1.5 flex gap-3 text-[11px] font-semibold">
                    {item.place_id && (
                      <Link
                        to={`/trips/${tripId}/places/${item.place_id}`}
                        className="font-bold text-brand"
                      >
                        View place ↗
                      </Link>
                    )}
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          className="text-muted"
                          onClick={() => setEditingId(item.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-brand"
                          onClick={() => setDeletingId(item.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          )}
        </ol>
      )}

      {adding && (
        <div className="mt-2 rounded-2xl border border-line bg-white p-3">
          <ItemForm
            pending={create.isPending}
            error={create.error}
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSubmit={(input) =>
              create.mutate(
                { ...input, day, zone_id: zoneId },
                { onSuccess: () => setAdding(false) }
              )
            }
          />
        </div>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        title="Remove this activity?"
        message="This only removes it from the day's plan."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deletingId) remove.mutate(deletingId)
          setDeletingId(null)
        }}
        onCancel={() => setDeletingId(null)}
      />
    </section>
  )
}

interface FormValues {
  title: string
  start_time: string | null
  note: string | null
  /** Only sent when editing moved the activity to another day. */
  day?: string
}

function ItemForm({
  initial,
  day,
  tripRange,
  pending,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ItineraryItem
  /** The day being edited; omitted on the add form, which is already on it. */
  day?: string
  /** Bounds for the date picker. Null until the trip loads — the field waits. */
  tripRange?: { start: string; end: string } | null
  pending: boolean
  error: unknown
  submitLabel: string
  onSubmit: (values: FormValues) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [time, setTime] = useState(initial?.start_time ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [date, setDate] = useState(initial?.day ?? day ?? '')

  // Moving is offered when editing an existing activity, not when adding one to
  // the day you are already looking at.
  const canMove = !!initial && !!tripRange

  const submit = () => {
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      start_time: time || null,
      note: note.trim() || null,
      ...(canMove && date && date !== initial.day ? { day: date } : {}),
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="field flex-1"
          placeholder="What are you doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Activity"
          autoFocus
        />
        <input
          type="time"
          className="field w-28 shrink-0"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Time"
        />
      </div>
      <textarea
        className="field min-h-16"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Note"
      />
      {canMove && (
        <div>
          <label className="label block" htmlFor={`day-${initial.id}`}>
            Day
          </label>
          <input
            id={`day-${initial.id}`}
            type="date"
            className="field mt-1"
            value={date}
            min={tripRange.start}
            max={tripRange.end}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Day"
          />
          {date && date !== initial.day && (
            <p className="mt-1 text-xs text-muted">Moves to {fmtDayLong(date)}.</p>
          )}
        </div>
      )}
      {!!error && (
        <p className="text-sm text-brand">
          {saveErrorMessage(error, 'Save failed — your text is kept, try again.')}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : error ? 'Retry' : submitLabel}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
