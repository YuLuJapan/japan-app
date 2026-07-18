// Self-service editing of the trip schedule: add/edit/delete/reorder the
// zones + date ranges that make up "the journey" slider on the home page.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTrip, useZones } from '../api/hooks'
import { useCreateStep, useDeleteStep, useMoveStep, useUpdateStep } from '../api/mutations'
import type { TripStep, Zone } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export default function JourneySteps() {
  const trip = useTrip()
  const zones = useZones()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const create = useCreateStep()
  const update = useUpdateStep()
  const remove = useDeleteStep()
  const move = useMoveStep()

  if (trip.isPending || zones.isPending) return <Loading label="Loading the journey…" />
  if (trip.isError || zones.isError)
    return (
      <ErrorState
        message="Could not load the journey."
        onRetry={() => {
          trip.refetch()
          zones.refetch()
        }}
      />
    )

  const steps = trip.data.steps
  const zoneList = zones.data.zones

  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm font-semibold text-muted">
        ‹ Back
      </Link>
      <div>
        <h1 className="font-display text-2xl font-extrabold">Edit the journey</h1>
        <p className="mt-1 text-sm text-muted">
          Reorder stops, change dates, or add/remove a city.
        </p>
      </div>

      <ol className="space-y-2">
        {steps.map((step, i) =>
          editingId === step.id ? (
            <li key={step.id} className="rounded-2xl border border-line bg-white p-3">
              <StepForm
                zones={zoneList}
                initial={step}
                pending={update.isPending}
                error={update.isError}
                submitLabel="Save"
                onCancel={() => setEditingId(null)}
                onSubmit={(input) =>
                  update.mutate(
                    { id: step.id, patch: input },
                    { onSuccess: () => setEditingId(null) }
                  )
                }
              />
            </li>
          ) : (
            <li
              key={step.id}
              className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3"
            >
              <div className="flex shrink-0 flex-col items-center gap-1">
                <button
                  type="button"
                  aria-label="Move up"
                  className="text-muted disabled:opacity-30"
                  disabled={i === 0 || move.isPending}
                  onClick={() => move.mutate({ id: step.id, direction: 'up' })}
                >
                  ▲
                </button>
                <span className="text-xs font-bold text-muted">{i + 1}</span>
                <button
                  type="button"
                  aria-label="Move down"
                  className="text-muted disabled:opacity-30"
                  disabled={i === steps.length - 1 || move.isPending}
                  onClick={() => move.mutate({ id: step.id, direction: 'down' })}
                >
                  ▼
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-snug">{step.zone?.name ?? 'Unknown zone'}</p>
                <p className="text-sm text-muted">
                  {fmt(step.start_date)} – {fmt(step.end_date)}
                </p>
                <div className="mt-2 flex gap-3 text-xs font-semibold">
                  <button
                    type="button"
                    className="text-muted"
                    onClick={() => setEditingId(step.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-brand"
                    onClick={() => setDeletingId(step.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          )
        )}
      </ol>

      {adding ? (
        <div className="rounded-2xl border border-line bg-white p-3">
          <StepForm
            zones={zoneList}
            pending={create.isPending}
            error={create.isError}
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSubmit={(input) => create.mutate(input, { onSuccess: () => setAdding(false) })}
          />
        </div>
      ) : (
        <button type="button" className="btn-ghost w-full" onClick={() => setAdding(true)}>
          + Add a stop
        </button>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        title="Remove this stop?"
        message="This removes it from the journey. Any day activities already planned for it are kept."
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
  zone_id: string
  start_date: string
  end_date: string
}

function StepForm({
  zones,
  initial,
  pending,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  zones: Zone[]
  initial?: TripStep
  pending: boolean
  error: boolean
  submitLabel: string
  onSubmit: (values: FormValues) => void
  onCancel: () => void
}) {
  const [zoneId, setZoneId] = useState(initial?.zone?.id ?? zones[0]?.id ?? '')
  const [startDate, setStartDate] = useState(initial?.start_date ?? '')
  const [endDate, setEndDate] = useState(initial?.end_date ?? '')

  const submit = () => {
    if (!zoneId || !startDate || !endDate) return
    onSubmit({ zone_id: zoneId, start_date: startDate, end_date: endDate })
  }

  return (
    <div className="space-y-2">
      <select
        className="field"
        value={zoneId}
        onChange={(e) => setZoneId(e.target.value)}
        aria-label="Zone"
      >
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          type="date"
          className="field flex-1"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          aria-label="Start date"
        />
        <input
          type="date"
          className="field flex-1"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          aria-label="End date"
        />
      </div>
      {error && <p className="text-sm text-brand">Save failed — try again.</p>}
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
