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
import {
  tripDateImpact,
  useCurrencies,
  useTrip,
  useTripInvites,
  useTripMembers,
} from '../api/hooks'
import { useCreateInvite, useCreateTrip, useDeleteTrip, useUpdateTrip } from '../api/mutations'
import type { StrandedResolution, Traveller, Trip, TripDateImpact } from '../api/types'
import { saveErrorMessage } from '../lib/errors'
import { AccessPicker, DEFAULT_SHOWS, type InviteRole, type Shows } from './AccessPicker'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// What a trip is calculated in until someone says otherwise — the pair the
// exchange calculator was hard-coded to before it could be chosen.
const DEFAULT_LOCAL_CURRENCY = 'JPY'
const DEFAULT_HOME_CURRENCIES = ['USD', 'ILS']
/** More than a few conversion cards stops being a glance on a phone. */
const MAX_HOME_CURRENCIES = 3
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Nights in a stay — how the journey already counts a stop's length. */
const nightsBetween = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)

/** A packed trip can strand dozens of activities — list a readable slice. */
const LIST_MAX = 12
/** Above this, say out loud what moving them all onto one day costs. */
const CROWD_WARN = 5

/** The button says what the tap will actually do to the plan, not just "Save". */
function submitLabel({
  pending,
  checking,
  mode,
  steps,
  items,
  resolution,
}: {
  pending: boolean
  checking: boolean
  mode: 'add' | 'edit'
  steps: number
  items: number
  resolution: StrandedResolution
}): string {
  if (pending) return 'Saving…'
  if (checking) return 'Checking the dates…'
  if (mode === 'add') return 'Create trip'
  const parts: string[] = []
  if (steps) parts.push(`move ${plural(steps, 'stop', 'stops')}`)
  if (items)
    parts.push(
      `${resolution === 'delete' ? 'delete' : 'move'} ${plural(items, 'activity', 'activities')}`
    )
  if (!parts.length) return 'Save changes'
  const text = parts.join(' & ')
  return `${text[0].toUpperCase()}${text.slice(1)} & save`
}

/**
 * What the new dates would strand, and what to do about it. Activities are
 * listed in a collapsed disclosure (a day plan can be long) with a choice of
 * moving them onto the trip's first day — the default, since it keeps the plan
 * — or deleting them.
 *
 * Stops travel with the trip and are stated rather than offered: they move to
 * the first day, keeping their length. There is no "delete" here (that belongs
 * to the journey editor's confirmed delete) and no "leave it" either — a stop
 * outside the trip's dates is exactly what the API refuses, and sending the
 * traveller to fix it first is a deadlock, since a stop cannot leave the window
 * the trip still has.
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
          <ul className="mt-1 space-y-1">
            {steps.map((s) => {
              const was = nightsBetween(s.start_date, s.end_date)
              const now = nightsBetween(s.moves_to.start_date, s.moves_to.end_date)
              return (
                <li key={s.id} className="text-xs text-muted">
                  <span className="font-semibold text-ink">{s.zone_name ?? 'Unknown stop'}</span>{' '}
                  {fmtPreview(s.start_date)} – {fmtPreview(s.end_date)}
                  <br />
                  <span aria-hidden>↳ </span>
                  <span className="font-semibold text-ink">
                    {fmtPreview(s.moves_to.start_date)} – {fmtPreview(s.moves_to.end_date)}
                  </span>
                  {now < was && (
                    <span className="font-semibold text-brand-700">
                      {' '}
                      · shortened to {plural(now, 'night', 'nights')} (was {was})
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">
            {steps.length === 1 ? 'It moves' : 'They move'} to the first day
            {firstDay && ` · ${fmtPreview(firstDay)}`}
            {steps.some(
              (s) =>
                nightsBetween(s.moves_to.start_date, s.moves_to.end_date) <
                nightsBetween(s.start_date, s.end_date)
            )
              ? ', clipped where the trip is no longer long enough to hold the stay'
              : `, keeping ${steps.length === 1 ? 'its length' : 'their lengths'}`}
            {steps.length > 1 && ', so they land on top of each other'}. Re-space
            {steps.length === 1 ? ' it' : ' them'} on the journey editor afterwards.
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
                That stacks {items.length} activities onto one day, and their original days are not
                kept.
              </p>
            )}
          </fieldset>
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
  const tripId = trip?.id ?? ''
  const create = useCreateTrip()
  const update = useUpdateTrip(tripId)
  const remove = useDeleteTrip()

  // Sharing, from the roster. Only meaningful once the trip exists — an
  // invitation belongs to a trip, and in add mode there isn't one yet.
  const bundle = useTrip(tripId)
  // The currencies a trip can be priced in, plus the guess to make from a
  // country. Served rather than bundled so it matches what the API validates.
  const catalogue = useCurrencies()
  const members = useTripMembers(tripId)
  const invites = useTripInvites(tripId)
  const createInvite = useCreateInvite(tripId)

  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [sy, setSy] = useState('')
  const [sm, setSm] = useState('')
  const [sd, setSd] = useState('')
  const [ey, setEy] = useState('')
  const [em, setEm] = useState('')
  const [ed, setEd] = useState('')
  const [people, setPeople] = useState<Traveller[]>([])
  // The exchange calculator's two sides: what you spend there, and what you
  // want it converted into.
  const [localCurrency, setLocalCurrency] = useState(DEFAULT_LOCAL_CURRENCY)
  const [homeCurrencies, setHomeCurrencies] = useState<string[]>([...DEFAULT_HOME_CURRENCIES])
  // Once the traveller picks a currency themselves, typing a country stops
  // overruling them.
  const [currencyPicked, setCurrencyPicked] = useState(false)
  const [personName, setPersonName] = useState('')
  const [personEmail, setPersonEmail] = useState('')
  const [confirm, setConfirm] = useState<0 | 1 | 2>(0)
  const [reason, setReason] = useState('')
  const [personError, setPersonError] = useState(false)
  // Which traveller's access is being chosen, by roster index. null = none.
  const [inviting, setInviting] = useState<number | null>(null)
  const [inviteRole, setInviteRole] = useState<InviteRole>('viewer')
  const [inviteShows, setInviteShows] = useState<Shows>(DEFAULT_SHOWS)
  const [inviteError, setInviteError] = useState<string | null>(null)

  // Inviting is a separate write from saving the trip, and lands on a separate
  // endpoint — so it happens on tap, not on Save. That also means an
  // invitation survives closing the sheet without saving, which is the
  // behaviour someone expects after being told "invited".
  const myRole = bundle.data?.my_role ?? null
  const canShare = mode === 'edit' && !!tripId && (myRole === 'owner' || myRole === 'partner')

  const sameAddress = (a: string | null | undefined, b: string) =>
    !!a && a.trim().toLowerCase() === b.trim().toLowerCase()

  /**
   * Where this address already stands on the trip. A roster entry and a
   * membership are different things — someone can be on the roster without an
   * account, or a member without being a traveller — so this answers only
   * "have they already been invited or joined?".
   */
  const shareState = (email: string): 'member' | 'invited' | 'none' => {
    if (members.data?.members.some((m) => sameAddress(m.email, email))) return 'member'
    const invite = invites.data?.invites.find((i) => sameAddress(i.email, email))
    return invite && !invite.declined_at ? 'invited' : 'none'
  }

  function ShareChip({ email, index }: { email: string; index: number }) {
    const state = shareState(email)
    if (state === 'member') return <span className="text-xs font-semibold text-muted">On trip</span>
    if (state === 'invited')
      return <span className="text-xs font-semibold text-muted">Invited</span>
    return (
      <button
        type="button"
        className="text-xs font-bold text-brand"
        onClick={() => {
          setInviteError(null)
          setInviteRole('viewer')
          setInviteShows(DEFAULT_SHOWS)
          setInviting(inviting === index ? null : index)
        }}
      >
        {inviting === index ? 'Cancel' : 'Invite'}
      </button>
    )
  }

  async function sendInvite(email: string) {
    setInviteError(null)
    try {
      await createInvite.mutateAsync({ role: inviteRole, email, ...inviteShows })
      setInviting(null)
    } catch (err) {
      setInviteError(saveErrorMessage(err))
    }
  }
  // What the new dates would strand, once checked; null until the traveller saves.
  const [impact, setImpact] = useState<TripDateImpact | null>(null)
  const [resolution, setResolution] = useState<StrandedResolution>('move')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!mode) return
    if (mode === 'edit' && trip) {
      const start = splitDate(trip.start_date)
      const end = splitDate(trip.end_date)
      setName(trip.name ?? '')
      setCountry(trip.country ?? '')
      setSy(start.y)
      setSm(start.m)
      setSd(start.d)
      setEy(end.y)
      setEm(end.m)
      setEd(end.d)
      setPeople(trip.people)
      setLocalCurrency(trip.local_currency)
      setHomeCurrencies(trip.home_currencies)
      setCurrencyPicked(true)
    } else {
      setName('')
      setSy('')
      setSm('')
      setSd('')
      setEy('')
      setEm('')
      setEd('')
      setPeople([])
      setCountry('')
      setLocalCurrency(DEFAULT_LOCAL_CURRENCY)
      setHomeCurrencies([...DEFAULT_HOME_CURRENCIES])
      setCurrencyPicked(false)
    }
    setPersonName('')
    setPersonEmail('')
    setPersonError(false)
    setInviting(null)
    setInviteRole('viewer')
    setInviteShows(DEFAULT_SHOWS)
    setInviteError(null)
    setConfirm(0)
    setReason('')
    setImpact(null)
    setResolution('move')
    setChecking(false)
  }, [mode, trip])

  if (!mode) return null

  const currencies = catalogue.data?.currencies ?? []
  const currencyName = (code: string) => currencies.find((c) => c.code === code)?.name ?? code
  /** Every code offered, with whatever is already chosen always among them. */
  const options = currencies.length
    ? currencies
    : [...new Set([localCurrency, ...homeCurrencies])].map((code) => ({ code, name: code }))
  const addable = options.filter((c) => !homeCurrencies.includes(c.code))

  /**
   * A country usually settles the currency, so typing one fills it in — until
   * the traveller picks for themselves, after which their choice stands.
   */
  const onCountry = (value: string) => {
    setCountry(value)
    if (currencyPicked) return
    const guess = catalogue.data?.by_country[value.trim().toLowerCase()]
    if (guess) setLocalCurrency(guess)
  }

  const startDate = joinDate(sy, sm, sd)
  const endDate = joinDate(ey, em, ed)
  const mutation = mode === 'edit' ? update : create
  const canSubmit =
    name.trim() && startDate && endDate && endDate >= startDate && homeCurrencies.length > 0
  const datesChanged =
    mode === 'edit' && !!trip && (startDate !== trip.start_date || endDate !== trip.end_date)

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

  const save = (found?: TripDateImpact | null) => {
    const input = {
      name: name.trim(),
      country: country.trim(),
      start_date: startDate,
      end_date: endDate,
      people,
      local_currency: localCurrency,
      home_currencies: homeCurrencies,
    }
    if (mode !== 'edit') {
      create.mutate(input, { onSuccess: onClose })
      return
    }
    update.mutate(
      {
        ...input,
        ...(found?.items.length ? { stranded_activities: resolution } : {}),
        ...(found?.steps.length ? { stranded_stops: 'move' as const } : {}),
      },
      { onSuccess: onClose }
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    // Second press: the traveller has seen what is in the way and chosen.
    if (impact) {
      save(impact)
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
        <h2 className="font-display text-2xl font-bold tracking-tight">
          {mode === 'edit' ? 'Edit trip' : 'Add a destination'}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {mode === 'edit'
            ? 'Change the name, the dates or who is coming.'
            : 'Where and when, and who is coming. The name is optional.'}
        </p>

        <label className="label mt-4 block" htmlFor="trip-country">
          Country
        </label>
        <input
          id="trip-country"
          className="field mt-1"
          placeholder="Japan"
          value={country}
          onChange={(e) => onCountry(e.target.value)}
          maxLength={80}
        />

        <label className="label mt-4 block" htmlFor="trip-name">
          Name it (optional)
        </label>
        <input
          id="trip-name"
          className="field mt-1"
          placeholder="Honeymoon"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
        {/* The rule, not a live preview: computing the title here would be a
            second implementation of server/src/lib/trip-title.ts, and the two
            would drift. The real one arrives with the very next response. */}
        <p className="mt-1 text-xs text-muted">
          Leave it empty and we’ll name it after whoever’s coming and where you’re going.
        </p>

        <label className="label mt-4 block" htmlFor="trip-local-currency">
          Money spent there
        </label>
        <select
          id="trip-local-currency"
          className="field mt-1"
          value={localCurrency}
          onChange={(e) => {
            setLocalCurrency(e.target.value)
            setCurrencyPicked(true)
          }}
        >
          {options.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>

        <span className="label mt-3 block">Converted to</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {homeCurrencies.map((code) => (
            <span
              key={code}
              className="flex items-center gap-2 rounded-full border border-line bg-white py-1.5 pl-3 pr-2 text-sm font-semibold"
            >
              {code}
              <span className="font-normal text-muted">{currencyName(code)}</span>
              {/* The last one can't go: a calculator with nothing on the right
                  side has nothing to say. */}
              {homeCurrencies.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove ${code}`}
                  className="text-muted"
                  onClick={() => setHomeCurrencies((cs) => cs.filter((c) => c !== code))}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        {homeCurrencies.length < MAX_HOME_CURRENCIES && addable.length > 0 && (
          <select
            className="field mt-2"
            aria-label="Add a currency to convert to"
            value=""
            onChange={(e) => {
              const code = e.target.value
              if (code) setHomeCurrencies((cs) => (cs.includes(code) ? cs : [...cs, code]))
            }}
          >
            <option value="">Add another currency…</option>
            {addable.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        )}
        <p className="mt-1 text-xs text-muted">
          What the exchange calculator converts: {localCurrency} into{' '}
          {homeCurrencies.join(', ') || '…'}.
        </p>

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
            {canShare
              ? 'Add an email and you can invite them to this trip, choosing what they see.'
              : 'Add an email now; you can invite them once the trip is saved.'}
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
                  {p.name?.[0]?.toUpperCase()}
                </span>
                <span className="text-sm font-semibold">{p.name}</span>
                {p.email && canShare && <ShareChip email={p.email} index={i} />}
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

        {inviting !== null && people[inviting]?.email && (
          <div className="mt-3 rounded-2xl border border-line bg-canvas p-3.5">
            <p className="text-sm font-semibold text-ink">
              Invite {people[inviting].name}
              <span className="font-normal text-muted"> · {people[inviting].email}</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              The invitation is waiting for them the next time they sign in — nothing to send.
            </p>
            <div className="mt-3">
              <AccessPicker
                actorRole={myRole}
                role={inviteRole}
                onRole={setInviteRole}
                shows={inviteShows}
                onShows={setInviteShows}
                idPrefix="roster-invite"
              />
            </div>
            {inviteError && <p className="mt-2 text-xs font-semibold text-brand">{inviteError}</p>}
            <button
              type="button"
              className="btn mt-3 w-full bg-ink text-white"
              disabled={createInvite.isPending}
              onClick={() => sendInvite(people[inviting].email!)}
            >
              {createInvite.isPending ? 'Inviting…' : 'Send invitation'}
            </button>
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
            disabled={!canSubmit || checking || mutation.isPending}
          >
            {submitLabel({
              pending: mutation.isPending,
              checking,
              mode,
              steps: impact?.steps.length ?? 0,
              items: impact?.items.length ?? 0,
              resolution,
            })}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
