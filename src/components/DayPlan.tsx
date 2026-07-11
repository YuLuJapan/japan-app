// One day's activities: an ordered list with inline add / edit / delete.
// Items may link to a saved place; deletes are confirmed. Times are optional —
// timed items sort ahead of "anytime" ones (server order).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useCreateItineraryItem,
  useDeleteItineraryItem,
  useUpdateItineraryItem,
} from '../api/mutations'
import type { ItineraryItem } from '../api/types'
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
}

export function DayPlan({ day, items, zoneId = null }: Props) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const create = useCreateItineraryItem()
  const update = useUpdateItineraryItem()
  const remove = useDeleteItineraryItem()

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="section-title">Plan</h3>
        {!adding && (
          <button type="button" className="text-sm font-bold text-brand" onClick={() => setAdding(true)}>
            + Add activity
          </button>
        )}
      </div>

      {items.length === 0 && !adding ? (
        <EmptyState message="Nothing planned for this day yet." />
      ) : (
        <ol className="space-y-2">
          {items.map((item) =>
            editingId === item.id ? (
              <li key={item.id} className="rounded-2xl border border-line bg-white p-3">
                <ItemForm
                  initial={item}
                  pending={update.isPending}
                  error={update.isError}
                  submitLabel="Save"
                  onCancel={() => setEditingId(null)}
                  onSubmit={(patch) =>
                    update.mutate(
                      { id: item.id, patch },
                      { onSuccess: () => setEditingId(null) }
                    )
                  }
                />
              </li>
            ) : (
              <li key={item.id} className="flex gap-3 rounded-2xl border border-line bg-white p-3">
                <div className="w-16 shrink-0 pt-0.5">
                  {item.start_time ? (
                    <span className="text-sm font-extrabold text-brand">{fmtTime(item.start_time)}</span>
                  ) : (
                    <span className="text-xs font-semibold text-muted">Anytime</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold leading-snug">{item.title}</p>
                  {item.note && <p className="mt-0.5 text-sm text-muted">{item.note}</p>}
                  {item.place_id && (
                    <Link to={`/places/${item.place_id}`} className="mt-1 inline-block text-xs font-bold text-brand">
                      View place ↗
                    </Link>
                  )}
                  <div className="mt-2 flex gap-3 text-xs font-semibold">
                    <button type="button" className="text-muted" onClick={() => setEditingId(item.id)}>
                      Edit
                    </button>
                    <button type="button" className="text-brand" onClick={() => setDeletingId(item.id)}>
                      Delete
                    </button>
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
            error={create.isError}
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
}

function ItemForm({
  initial,
  pending,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: ItineraryItem
  pending: boolean
  error: boolean
  submitLabel: string
  onSubmit: (values: FormValues) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [time, setTime] = useState(initial?.start_time ?? '')
  const [note, setNote] = useState(initial?.note ?? '')

  const submit = () => {
    if (!title.trim()) return
    onSubmit({ title: title.trim(), start_time: time || null, note: note.trim() || null })
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
      {error && <p className="text-sm text-brand">Save failed — your text is kept, try again.</p>}
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
