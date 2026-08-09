// Add/edit a trip: name, dates as day·month·year dropdowns (not a date picker
// — rejected explicitly in the design chat), and free-text traveller names as
// chips. Editing also offers delete, gated behind a double confirmation: a
// warning panel, then a required reason before "Delete for good" activates.
//
// Shortening or moving the dates can leave activities outside the trip. Saving
// therefore dry-runs the change first (GET /trips/:id/date-impact) and, when
// something is in the way, lists it and asks what should happen to it before
// anything is written.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { tripDateImpact } from '../api/hooks'
import { useCreateTrip, useDeleteTrip, useUpdateTrip } from '../api/mutations'
import type { StrandedResolution, Traveller, Trip, TripDateImpact } from '../api/types'
import { saveErrorMessage } from '../lib/errors'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const DAY_OPTS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))
const MONTH_OPTS = MONTHS.map((label, i) => ({ value: String(i + 1).padStart(2, '0'), label }))
const thisYear = new Date().getFullYear()
const YEAR_OPTS = Array.from({ length: 7 }, (_, i) => String(thisYear - 1 + i))

const REASONS = [
  { value: '', label: 'Pick a reason…' },
  { value: 'cancelled', label: 'The trip was cancelled' },
  { value: 'postponed', label: 'Postponed — I will plan it later' },
  { value: 'duplicate', label: 'Created it twice by mistake' },
  { value: 'over', label: 'The trip is over' },
  { value: 'test', label: 'Just testing / practice trip' },
  { value: 'other', label: 'Something else' },
]

/** ISO date → { y, m, d } dropdown values; blank when there's no date yet. */
function splitDate(iso: string | undefined) {
  if (!iso) return { y: '', m: '', d: '' }
  const [y, m, d] = iso.split('-')
  return { y, m, d }
}

function joinDate(y: string, m: string, d: string): string {
  if (!y || !m || !d) return ''
  return `${y}-${m}-${d}`
}

const fmtPreview = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

function avatarBg(name: string): string {
  const palette = ['#F1543F', '#17150F', '#6E8248', '#4C6273', '#B07A62', '#8A5FA8']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997
  return palette[h % palette.length]
}

/** No accounts to invite into — this just hands the guest link + a nudge to
 *  the traveller's own inbox via the device's mail app. No server email involved. */
function inviteHref(email: string, tripName: string): string {
  const subject = `Join us on Onward${tripName ? ` — ${tripName}` : ''}`
  const body = [
    `Hey! I added you as a traveller on ${tripName ? `"${tripName}"` : 'our trip'} on Onward.`,
    '',
    `Sign in at ${window.location.origin}/gate with the trip's guest code (ask us if you don't have it) to see the plans, shopping list and documents.`,
  ].join('\n')
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A packed trip can strand dozens of activities — list a readable slice. */
const LIST_MAX = 12
/** Above this, say out loud what moving them all onto one day costs. */
const CROWD_WARN = 5

function submitLabel({
  pending,
  checking,
  mode,
  items,
  blocked,
  resolution,
}: {
  pending: boolean
  checking: boolean
  mode: 'add' | 'edit'
  items: number
  blocked: boolean
  resolution: StrandedResolution
}): string {
  if (pending) return 'Saving…'
  if (checking) return 'Checking the dates…'
  if (mode === 'add') return 'Create trip'
  if (blocked || !items) return 'Save changes'
  return resolution === 'delete'
    ? `Delete ${plural(items, 'activity', 'activities')} & save`
    : `Move ${plural(items, 'activity', 'activities')} & save`
}

/**
 * What the new dates would strand, and what to do about it. Activities are
 * listed in a collapsed disclosure (a day plan can be long) with a choice of
 * moving them onto the trip's first day — the default, since it keeps the plan
 * — or deleting them. Stranded stops have no such choice: they are shown as
 * blocking, because a stop is a date range tied to a city and only the journey
 * editor can sensibly change one. When a stop blocks, the activity choice is
 * withheld rather than shown dead — the save is not one tap away.
 */
function StrandedPanel({
  impact,
  firstDay,
  resolution,
  onResolution,
}: {
  impact: TripDateImpact
  firstDay: string
  resolution: StrandedResolution
  onResolution: (r: StrandedResolution) => void
}) {
  const { steps, items } = impact
  return (
    <div className="mt-3 rounded-2xl border border-brand/30 bg-brand/5 p-3">
      {steps.length > 0 && (
        <div className={items.length ? 'border-b border-brand/20 pb-3' : undefined}>
          <p className="text-sm font-bold text-brand-700">
            {plural(steps.length, 'stop falls', 'stops fall')} outside the new dates
          </p>
          <ul className="mt-1 space-y-0.5">
            {steps.map((s) => (
              <li key={s.id} className="text-xs text-muted">
                <span className="font-semibold text-ink">{s.zone_name ?? 'Unknown stop'}</span>{' '}
                {fmtPreview(s.start_date)} – {fmtPreview(s.end_date)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Change {steps.length === 1 ? 'it' : 'them'} on the journey editor first — the dates
            can't move while a stop sits outside them.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className={steps.length ? 'pt-3' : undefined}>
          <p className="text-sm font-bold text-brand-700">
            {plural(items.length, 'activity falls', 'activities fall')} outside the new dates
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-semibold text-muted">
              Show {items.length === 1 ? 'it' : 'them'}
            </summary>
            <ul className="mt-1 space-y-0.5">
              {items.slice(0, LIST_MAX).map((i) => (
                <li key={i.id} className="text-xs text-muted">
                  <span className="font-semibold text-ink">{i.title}</span> · {fmtPreview(i.day)}
                  {i.start_time ? ` · ${i.start_time}` : ''}
                </li>
              ))}
              {items.length > LIST_MAX && (
                <li className="text-xs font-semibold text-muted">
                  + {items.length - LIST_MAX} more
                </li>
              )}
            </ul>
          </details>

          {/* No choice to offer while a stop blocks the whole change — asking
              would imply the save is one tap away when it is not. */}
          {steps.length > 0 ? (
            <p className="mt-2 text-xs text-muted">
              You'll be asked what to do with {items.length === 1 ? 'it' : 'them'} once the stops
              fit.
            </p>
          ) : (
            <fieldset className="mt-3">
              <legend className="sr-only">What should happen to them?</legend>
              <label className="flex items-start gap-2 py-1 text-sm">
                <input
                  type="radio"
                  name="stranded-activities"
                  className="mt-1"
                  checked={resolution === 'move'}
                  onChange={() => onResolution('move')}
                />
                <span>
                  Move to the first day
                  {firstDay && <span className="text-muted"> · {fmtPreview(firstDay)}</span>}
                </span>
              </label>
              <label className="flex items-start gap-2 py-1 text-sm">
                <input
                  type="radio"
                  name="stranded-activities"
                  className="mt-1"
                  checked={resolution === 'delete'}
                  onChange={() => onResolution('delete')}
                />
                <span>Delete {items.length === 1 ? 'it' : 'them'}</span>
              </label>
              {items.length > CROWD_WARN && resolution === 'move' && (
                <p className="mt-1 text-xs text-muted">
                  That stacks {items.length} activities onto one day, and their original days are
                  not kept.
                </p>
              )}
            </fieldset>
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  mode: 'add' | 'edit' | null
  trip?: Trip
  onClose: () => void
}

export function TripSheet({ mode, trip, onClose }: Props) {
  const create = useCreateTrip()
  const update = useUpdateTrip(trip?.id ?? '')
  const remove = useDeleteTrip()

  const [name, setName] = useState('')
  const [sy, setSy] = useState('')
  const [sm, setSm] = useState('')
  const [sd, setSd] = useState('')
  const [ey, setEy] = useState('')
  const [em, setEm] = useState('')
  const [ed, setEd] = useState('')
  const [people, setPeople] = useState<Traveller[]>([])
  const [personName, setPersonName] = useState('')
  const [personEmail, setPersonEmail] = useState('')
  const [confirm, setConfirm] = useState<0 | 1 | 2>(0)
  const [reason, setReason] = useState('')
  const [personError, setPersonError] = useState(false)
  // What the new dates would strand, once checked; null until the traveller saves.
  const [impact, setImpact] = useState<TripDateImpact | null>(null)
  const [resolution, setResolution] = useState<StrandedResolution>('move')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!mode) return
    if (mode === 'edit' && trip) {
      const start = splitDate(trip.start_date)
      const end = splitDate(trip.end_date)
      setName(trip.name)
      setSy(start.y)
      setSm(start.m)
      setSd(start.d)
      setEy(end.y)
      setEm(end.m)
      setEd(end.d)
      setPeople(trip.people)
    } else {
      setName('')
      setSy('')
      setSm('')
      setSd('')
      setEy('')
      setEm('')
      setEd('')
      setPeople([])
    }
    setPersonName('')
    setPersonEmail('')
    setPersonError(false)
    setConfirm(0)
    setReason('')
    setImpact(null)
    setResolution('move')
    setChecking(false)
  }, [mode, trip])

  if (!mode) return null

  const startDate = joinDate(sy, sm, sd)
  const endDate = joinDate(ey, em, ed)
  const mutation = mode === 'edit' ? update : create
  const canSubmit = name.trim() && startDate && endDate && endDate >= startDate
  const datesChanged =
    mode === 'edit' && !!trip && (startDate !== trip.start_date || endDate !== trip.end_date)
  // A stranded stop has no sensible auto-fix — the journey editor owns those.
  const blocked = !!impact?.steps.length

  const addPerson = () => {
    const n = personName.trim()
    if (!n || people.length >= 12) return
    const e = personEmail.trim()
    if (e && !EMAIL_RE.test(e)) {
      setPersonError(true)
      return
    }
    setPersonError(false)
    setPeople((p) => [...p, e ? { name: n, email: e } : { name: n }])
    setPersonName('')
    setPersonEmail('')
  }

  const save = (stranded?: StrandedResolution) => {
    const input = { name: name.trim(), start_date: startDate, end_date: endDate, people }
    if (mode !== 'edit') {
      create.mutate(input, { onSuccess: onClose })
      return
    }
    update.mutate(
      { ...input, ...(stranded ? { stranded_activities: stranded } : {}) },
      { onSuccess: onClose }
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || blocked) return
    // Second press: the traveller has seen what is in the way and chosen.
    if (impact) {
      save(resolution)
      return
    }
    if (!datesChanged) {
      save()
      return
    }
    setChecking(true)
    try {
      const found = await tripDateImpact(trip!.id, startDate, endDate)
      if (found.steps.length || found.items.length) setImpact(found)
      else save()
    } catch {
      // The dry run only exists to ask a better question. If it fails, save
      // anyway and let the PATCH be the judge — it enforces the same rule.
      save()
    } finally {
      setChecking(false)
    }
  }

  // Editing the dates again invalidates whatever the last dry run found.
  const pickDate = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    set(e.target.value)
    setImpact(null)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'edit' ? 'Edit trip' : 'Add a destination'}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-app overflow-y-auto rounded-t-[2rem] bg-canvas p-6 pb-8"
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line" />
        <h2 className="font-display text-2xl font-extrabold tracking-tight">
          {mode === 'edit' ? 'Edit trip' : 'Add a destination'}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {mode === 'edit'
            ? 'Change the name, the dates or who is coming.'
            : 'Name it, set the dates, say who is coming.'}
        </p>

        <label className="label mt-4 block" htmlFor="trip-name">
          Destination
        </label>
        <input
          id="trip-name"
          className="field mt-1"
          placeholder="Japan"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />

        <span className="label mt-4 block">Starts</span>
        <div className="mt-1 flex gap-2">
          <select
            className="field flex-1"
            aria-label="Start day"
            value={sd}
            onChange={pickDate(setSd)}
          >
            <option value="" disabled>
              Day
            </option>
            {DAY_OPTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            className="field flex-[1.5]"
            aria-label="Start month"
            value={sm}
            onChange={pickDate(setSm)}
          >
            <option value="" disabled>
              Month
            </option>
            {MONTH_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="field flex-[1.2]"
            aria-label="Start year"
            value={sy}
            onChange={pickDate(setSy)}
          >
            <option value="" disabled>
              Year
            </option>
            {YEAR_OPTS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <span className="label mt-3 block">Ends</span>
        <div className="mt-1 flex gap-2">
          <select
            className="field flex-1"
            aria-label="End day"
            value={ed}
            onChange={pickDate(setEd)}
          >
            <option value="" disabled>
              Day
            </option>
            {DAY_OPTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            className="field flex-[1.5]"
            aria-label="End month"
            value={em}
            onChange={pickDate(setEm)}
          >
            <option value="" disabled>
              Month
            </option>
            {MONTH_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className="field flex-[1.2]"
            aria-label="End year"
            value={ey}
            onChange={pickDate(setEy)}
          >
            <option value="" disabled>
              Year
            </option>
            {YEAR_OPTS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        {startDate && endDate && (
          <p className="mt-2 text-xs text-muted">
            {endDate < startDate
              ? 'End date is before the start date.'
              : `${fmtPreview(startDate)} – ${fmtPreview(endDate)}`}
          </p>
        )}

        {impact && (
          <StrandedPanel
            impact={impact}
            firstDay={startDate}
            resolution={resolution}
            onResolution={setResolution}
          />
        )}

        <span className="label mt-4 block">Who is travelling?</span>
        <div className="mt-1 flex gap-2">
          <input
            className="field flex-1"
            placeholder="Name"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addPerson()
              }
            }}
            maxLength={60}
            aria-label="Traveller name"
          />
          <input
            className="field flex-1"
            type="email"
            placeholder="Email (optional)"
            value={personEmail}
            onChange={(e) => {
              setPersonEmail(e.target.value)
              setPersonError(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addPerson()
              }
            }}
            aria-label="Traveller email (optional)"
          />
          <button
            type="button"
            onClick={addPerson}
            aria-label="Add traveller"
            className="flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-2xl bg-ink text-2xl font-bold leading-none text-white active:scale-95"
          >
            +
          </button>
        </div>
        {personError ? (
          <p className="mt-1 text-xs font-semibold text-brand">
            That doesn't look like a valid email.
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Add an email to invite them by mail — they still sign in with the trip's guest code
            (there are no individual logins).
          </p>
        )}
        {people.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {people.map((p, i) => (
              <span
                key={`${p.name}-${i}`}
                className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pl-1 pr-2"
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: avatarBg(p.name) }}
                  aria-hidden
                >
                  {p.name[0]?.toUpperCase()}
                </span>
                <span className="text-sm font-semibold">{p.name}</span>
                {p.email && (
                  <a
                    href={inviteHref(p.email, name)}
                    className="text-xs font-bold text-brand"
                    title={`Email an invite to ${p.email}`}
                  >
                    Invite
                  </a>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  className="text-muted"
                  onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {mode === 'edit' && (
          <div className="mt-5 border-t border-line pt-4">
            {confirm === 0 && (
              <button
                type="button"
                className="h-12 w-full rounded-2xl border border-brand/30 text-sm font-semibold text-brand-700"
                onClick={() => setConfirm(1)}
              >
                Delete this trip
              </button>
            )}
            {confirm === 1 && (
              <div className="rounded-2xl bg-brand/10 p-4">
                <p className="text-sm font-bold">Delete {name || 'this trip'}?</p>
                <p className="mt-1 text-sm text-muted">
                  Its plans, lists, reminders and documents go with it. This cannot be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn-ghost flex-1" onClick={() => setConfirm(0)}>
                    Keep it
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-2xl bg-brand-700 py-3 text-sm font-bold text-white"
                    onClick={() => setConfirm(2)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
            {confirm === 2 && (
              <div className="rounded-2xl border border-brand/30 bg-white p-4">
                <p className="text-sm font-bold text-brand-700">Last check</p>
                <p className="mt-1 text-sm text-muted">
                  Why are you deleting {name || 'this trip'}?
                </p>
                <select
                  className="field mt-2"
                  aria-label="Reason for deleting"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn-ghost flex-1" onClick={() => setConfirm(0)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!reason}
                    className="flex-1 rounded-2xl bg-brand-700 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => trip && remove.mutate(trip.id, { onSuccess: onClose })}
                  >
                    {remove.isPending ? 'Deleting…' : 'Delete for good'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {mutation.isError && (
          <p className="mt-4 text-sm font-semibold text-brand">
            {saveErrorMessage(mutation.error)}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={!canSubmit || blocked || checking || mutation.isPending}
          >
            {submitLabel({
              pending: mutation.isPending,
              checking,
              mode,
              items: impact?.items.length ?? 0,
              blocked,
              resolution,
            })}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
