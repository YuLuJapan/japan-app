// Add/edit a trip: name, dates as day·month·year dropdowns (not a date picker
// — rejected explicitly in the design chat), and free-text traveller names as
// chips. Editing also offers delete, gated behind a double confirmation: a
// warning panel, then a required reason before "Delete for good" activates.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCreateTrip, useDeleteTrip, useUpdateTrip } from '../api/mutations'
import type { Traveller, Trip } from '../api/types'
import { CURRENCIES, CURRENCY_NAMES, type CurrencyCode } from '../lib/currency'

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
  const [localCurrency, setLocalCurrency] = useState<CurrencyCode>('JPY')
  const [personName, setPersonName] = useState('')
  const [personEmail, setPersonEmail] = useState('')
  const [confirm, setConfirm] = useState<0 | 1 | 2>(0)
  const [reason, setReason] = useState('')
  const [personError, setPersonError] = useState(false)

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
      setLocalCurrency(trip.local_currency)
    } else {
      setName('')
      setSy('')
      setSm('')
      setSd('')
      setEy('')
      setEm('')
      setEd('')
      setPeople([])
      setLocalCurrency('JPY')
    }
    setPersonName('')
    setPersonEmail('')
    setPersonError(false)
    setConfirm(0)
    setReason('')
  }, [mode, trip])

  if (!mode) return null

  const startDate = joinDate(sy, sm, sd)
  const endDate = joinDate(ey, em, ed)
  const mutation = mode === 'edit' ? update : create
  const canSubmit = name.trim() && startDate && endDate && endDate >= startDate

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

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const input = {
      name: name.trim(),
      start_date: startDate,
      end_date: endDate,
      people,
      local_currency: localCurrency,
    }
    if (mode === 'edit') update.mutate(input, { onSuccess: onClose })
    else create.mutate(input, { onSuccess: onClose })
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

        <label className="label mt-4 block" htmlFor="trip-currency">
          Local currency
        </label>
        <select
          id="trip-currency"
          className="field mt-1"
          value={localCurrency}
          onChange={(e) => setLocalCurrency(e.target.value as CurrencyCode)}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c} — {CURRENCY_NAMES[c]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">
          Used by the exchange calculator on the Essentials tab.
        </p>

        <span className="label mt-4 block">Starts</span>
        <div className="mt-1 flex gap-2">
          <select
            className="field flex-1"
            aria-label="Start day"
            value={sd}
            onChange={(e) => setSd(e.target.value)}
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
            onChange={(e) => setSm(e.target.value)}
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
            onChange={(e) => setSy(e.target.value)}
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
            onChange={(e) => setEd(e.target.value)}
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
            onChange={(e) => setEm(e.target.value)}
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
            onChange={(e) => setEy(e.target.value)}
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
          <p className="mt-4 text-sm font-semibold text-brand">Save failed — try again.</p>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create trip'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
