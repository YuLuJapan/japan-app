// Self-service editing of the trip schedule: add/edit/delete the destinations
// + date ranges that make up "the journey" slider on the home page. Order is
// derived from start_date server-side — there is no manual reordering.
// Destinations are free text, validated against real places via the geocode
// autocomplete (Nominatim) rather than picked from a fixed zone list.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { geocode, useTrip } from '../api/hooks'
import { useCreateStep, useDeleteStep, useUpdateStep } from '../api/mutations'
import type { GeocodeResult, JourneyStepInput, TripStep } from '../api/types'
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
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const create = useCreateStep()
  const update = useUpdateStep()
  const remove = useDeleteStep()

  if (trip.isPending) return <Loading label="Loading the journey…" />
  if (trip.isError)
    return <ErrorState message="Could not load the journey." onRetry={() => trip.refetch()} />

  const steps = trip.data.steps

  return (
    <div className="space-y-4">
      <Link to="/" className="text-sm font-semibold text-muted">
        ‹ Back
      </Link>
      <div>
        <h1 className="font-display text-2xl font-extrabold">Edit the journey</h1>
        <p className="mt-1 text-sm text-muted">
          Change dates, or add or remove a destination. Stops are ordered by arrival date.
        </p>
      </div>

      <ol className="space-y-2">
        {steps.map((step, i) =>
          editingId === step.id ? (
            <li key={step.id} className="rounded-2xl border border-line bg-white p-3">
              <DestinationForm
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
              <div className="flex w-6 shrink-0 items-center justify-center">
                <span className="text-xs font-bold text-muted">{i + 1}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-snug">{step.zone?.name ?? 'Unknown destination'}</p>
                <p className="text-sm text-muted">
                  {fmt(step.start_date)} – {fmt(step.end_date)}
                </p>
                <div className="mt-2 flex gap-3 text-xs font-semibold">
                  <button type="button" className="text-muted" onClick={() => setEditingId(step.id)}>
                    Edit
                  </button>
                  <button type="button" className="text-brand" onClick={() => setDeletingId(step.id)}>
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
          <DestinationForm
            pending={create.isPending}
            error={create.isError}
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSubmit={(input) => create.mutate(input, { onSuccess: () => setAdding(false) })}
          />
        </div>
      ) : (
        <button type="button" className="btn-ghost w-full" onClick={() => setAdding(true)}>
          + Add a destination
        </button>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        title="Remove this destination?"
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

function DestinationForm({
  initial,
  pending,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: TripStep
  pending: boolean
  error: boolean
  submitLabel: string
  onSubmit: (values: JourneyStepInput) => void
  onCancel: () => void
}) {
  const originalName = initial?.zone?.name ?? ''
  const [query, setQuery] = useState(originalName)
  const [selected, setSelected] = useState<GeocodeResult | null>(null)
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)
  const [startDate, setStartDate] = useState(initial?.start_date ?? '')
  const [endDate, setEndDate] = useState(initial?.end_date ?? '')

  // Editing an existing destination without touching the text field keeps the
  // current zone (no re-validation needed); adding, or changing the text,
  // requires picking a real place from the autocomplete before submitting.
  const destinationTouched = !initial || query.trim() !== originalName.trim()

  useEffect(() => {
    const q = query.trim()
    if (!destinationTouched || selected || q.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    let ignore = false
    setSearching(true)
    const t = setTimeout(() => {
      geocode(q)
        .then((r) => !ignore && setResults(r.results))
        .catch(() => !ignore && setResults([]))
        .finally(() => !ignore && setSearching(false))
    }, 450)
    return () => {
      ignore = true
      clearTimeout(t)
    }
  }, [query, destinationTouched, selected])

  const pickResult = (r: GeocodeResult) => {
    setSelected(r)
    setQuery(r.name)
    setResults([])
  }

  const canSubmit = !!startDate && !!endDate && (!destinationTouched || !!selected)

  const submit = () => {
    if (!canSubmit) return
    onSubmit({
      start_date: startDate,
      end_date: endDate,
      ...(selected ? { destination: selected } : {}),
    })
  }

  return (
    <div className="space-y-2">
      <div>
        <input
          className="field"
          placeholder="Search a city or place…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(null)
          }}
          aria-label="Destination"
        />
        {destinationTouched && !selected && query.trim().length >= 2 && (
          <div className="mt-1 overflow-hidden rounded-2xl ring-1 ring-line">
            {searching && <p className="px-3 py-2 text-sm text-muted">Searching…</p>}
            {!searching && results.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted">No matches — try a different name.</p>
            )}
            {results.map((r, i) => (
              <button
                key={`${r.lat},${r.lng},${i}`}
                type="button"
                onClick={() => pickResult(r)}
                className="flex w-full flex-col items-start border-b border-line bg-white px-3 py-2 text-left last:border-0 hover:bg-line/40 active:bg-line/60"
              >
                <span className="text-sm font-semibold">{r.name}</span>
                {r.address && <span className="line-clamp-1 text-xs text-muted">{r.address}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
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
      {destinationTouched && !selected && (
        <p className="text-xs text-muted">Pick a place from the suggestions to confirm it's real.</p>
      )}
      {error && <p className="text-sm text-brand">Save failed — try again.</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1"
          onClick={submit}
          disabled={pending || !canSubmit}
        >
          {pending ? 'Saving…' : error ? 'Retry' : submitLabel}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
