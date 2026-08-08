// The "featured" banners shown between a day's date and its plan — birthdays,
// park days, car pickup/return, anything worth flagging. A highlight is just an
// itinerary item with `highlight: true`, so it reuses the itinerary CRUD. Each
// banner has an icon + text and can be edited or removed inline; a button adds
// a new one to the current day.
import { useState } from 'react'
import {
  useCreateItineraryItem,
  useDeleteItineraryItem,
  useUpdateItineraryItem,
} from '../api/mutations'
import type { ItineraryItem } from '../api/types'
import { useCanEdit } from '../lib/session'
import { ConfirmDialog } from './ConfirmDialog'

const DEFAULT_ICON = '⭐'

interface Props {
  day: string
  highlights: ItineraryItem[]
  /** City this day belongs to; new highlights are tagged with it. */
  zoneId?: string | null
  tripId: string
}

export function DayHighlights({ day, highlights, zoneId = null, tripId }: Props) {
  const canEdit = useCanEdit()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const create = useCreateItineraryItem(tripId)
  const update = useUpdateItineraryItem()
  const remove = useDeleteItineraryItem()

  return (
    <div className="space-y-2">
      {highlights.map((h) =>
        editingId === h.id ? (
          <div key={h.id} className="rounded-2xl bg-brand/10 p-3">
            <HighlightForm
              initial={h}
              pending={update.isPending}
              error={update.isError}
              submitLabel="Save"
              onCancel={() => setEditingId(null)}
              onSubmit={(patch) =>
                update.mutate({ id: h.id, patch }, { onSuccess: () => setEditingId(null) })
              }
            />
          </div>
        ) : (
          <div key={h.id} className="flex items-center gap-3 rounded-2xl bg-brand/10 px-4 py-3">
            <span className="text-2xl leading-none" aria-hidden>
              {h.icon || DEFAULT_ICON}
            </span>
            <p className="min-w-0 flex-1 font-display text-sm font-extrabold text-brand-700">
              {h.title}
            </p>
            {canEdit && (
              <div className="flex shrink-0 gap-3 text-xs font-semibold">
                <button
                  type="button"
                  className="text-brand-700/70"
                  onClick={() => setEditingId(h.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-brand-700"
                  onClick={() => setDeletingId(h.id)}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        )
      )}

      {adding ? (
        <div className="rounded-2xl bg-brand/10 p-3">
          <HighlightForm
            pending={create.isPending}
            error={create.isError}
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSubmit={(input) =>
              create.mutate(
                { ...input, day, zone_id: zoneId, highlight: true },
                { onSuccess: () => setAdding(false) }
              )
            }
          />
        </div>
      ) : (
        canEdit && (
          <button
            type="button"
            className="text-xs font-bold text-brand"
            onClick={() => setAdding(true)}
          >
            + Add featured note
          </button>
        )
      )}

      <ConfirmDialog
        open={deletingId !== null}
        title="Remove this featured note?"
        message="This only removes the banner for this day."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deletingId) remove.mutate(deletingId)
          setDeletingId(null)
        }}
        onCancel={() => setDeletingId(null)}
      />
    </div>
  )
}

interface FormValues {
  title: string
  icon: string | null
}

function HighlightForm({
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
  const [icon, setIcon] = useState(initial?.icon ?? DEFAULT_ICON)
  const [title, setTitle] = useState(initial?.title ?? '')

  const submit = () => {
    if (!title.trim()) return
    onSubmit({ title: title.trim(), icon: icon.trim() || null })
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          className="field w-16 shrink-0 text-center text-xl"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          aria-label="Icon"
          maxLength={8}
        />
        <input
          className="field flex-1"
          placeholder="What's special about this day?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-label="Featured note"
          autoFocus
        />
      </div>
      {error && (
        <p className="text-sm text-brand-700">Save failed — your text is kept, try again.</p>
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
