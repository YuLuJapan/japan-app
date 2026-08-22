// Reminders: schedule a nudge ("book the ryokan") that arrives as a phone
// notification even when the app is closed. Times are stored as absolute
// instants and typed in Israel time by default — the chip switches to Japan
// time for anything planned around the trip's own clock.
import { useState } from 'react'
import { ApiError } from '../api/client'
import { useReminders } from '../api/hooks'
import { useCreateReminder, useDeleteReminder, useUpdateReminder } from '../api/mutations'
import type { Reminder, ReminderInput } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { NotificationSetup } from '../components/NotificationSetup'
import {
  HOME_TZ,
  TOKYO_TZ,
  deviceTimeZone,
  formatInTimeZone,
  instantToWallClock,
  relativeTime,
  timeZoneLabel,
  wallClockToInstant,
} from '../lib/reminders'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'

const errorText = (error: unknown) =>
  error instanceof ApiError ? (error.details?.join(' · ') ?? error.message) : 'Something went wrong'

export default function Reminders() {
  const canEdit = useCanEdit()
  const tripId = useTripId()
  const reminders = useReminders(tripId)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const create = useCreateReminder(tripId)
  const update = useUpdateReminder()
  const remove = useDeleteReminder()

  if (reminders.isPending) return <Loading label="Loading reminders…" />
  if (reminders.isError)
    return <ErrorState message="Could not load reminders." onRetry={() => reminders.refetch()} />

  const now = new Date()
  const all = reminders.data.reminders
  const upcoming = all.filter((r) => !r.sent_at && new Date(r.remind_at) > now)
  const past = all.filter((r) => r.sent_at || new Date(r.remind_at) <= now).reverse()

  return (
    <div className="space-y-5">
      <div>
        <p className="section-title text-brand">Reminders</p>
        <h1 className="mt-1 font-display text-[34px] font-bold leading-[1.05] tracking-tight">
          Don&apos;t forget
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {canEdit
            ? "Get a notification when it's time to book a restaurant, a bus seat or an activity."
            : "What you've lined up to book or sort out before you fly."}
        </p>
      </div>

      {canEdit && <NotificationSetup />}

      {!canEdit ? null : adding ? (
        <div className="card p-4">
          <ReminderForm
            pending={create.isPending}
            error={create.isError ? errorText(create.error) : null}
            submitLabel="Add reminder"
            onCancel={() => setAdding(false)}
            onSubmit={(input) => create.mutate(input, { onSuccess: () => setAdding(false) })}
          />
        </div>
      ) : (
        <button type="button" className="btn-primary w-full" onClick={() => setAdding(true)}>
          + New reminder
        </button>
      )}

      <section className="space-y-2">
        <h2 className="section-title">Upcoming</h2>
        {upcoming.length === 0 && <p className="text-sm text-muted">Nothing scheduled yet.</p>}
        {upcoming.map((reminder) =>
          editingId === reminder.id ? (
            <div key={reminder.id} className="card p-4">
              <ReminderForm
                initial={reminder}
                pending={update.isPending}
                error={update.isError ? errorText(update.error) : null}
                submitLabel="Save"
                onCancel={() => setEditingId(null)}
                onSubmit={(patch) =>
                  update.mutate({ id: reminder.id, patch }, { onSuccess: () => setEditingId(null) })
                }
              />
            </div>
          ) : (
            <UpcomingReminderCard
              key={reminder.id}
              reminder={reminder}
              now={now}
              canEdit={canEdit}
              onEdit={() => setEditingId(reminder.id)}
              onDelete={() => setDeletingId(reminder.id)}
            />
          )
        )}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">Done</h2>
          {past.map((reminder) => (
            <DoneReminderCard
              key={reminder.id}
              reminder={reminder}
              canEdit={canEdit}
              onDelete={() => setDeletingId(reminder.id)}
            />
          ))}
        </section>
      )}

      <ConfirmDialog
        open={deletingId !== null}
        title="Delete this reminder?"
        message="It won't be sent."
        confirmLabel="Delete"
        onCancel={() => setDeletingId(null)}
        onConfirm={() => {
          if (deletingId) remove.mutate(deletingId)
          setDeletingId(null)
        }}
      />
    </div>
  )
}

const monthFmt = (tz: string) => new Intl.DateTimeFormat('en', { month: 'short', timeZone: tz })
const dayFmt = (tz: string) => new Intl.DateTimeFormat('en', { day: 'numeric', timeZone: tz })

/** Not-yet-sent reminder: white card with a date badge and an "in Xd" pill,
 *  matching the design prototype. */
function UpcomingReminderCard({
  reminder,
  now,
  canEdit,
  onEdit,
  onDelete,
}: {
  reminder: Reminder
  now: Date
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const zone = reminder.time_zone || HOME_TZ
  const when = new Date(reminder.remind_at)
  return (
    <article className="flex items-start gap-3.5 rounded-[22px] bg-white p-4 shadow-card">
      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl bg-[#FDECE8]">
        <span className="text-[9px] font-bold uppercase tracking-wide text-brand">
          {monthFmt(zone).format(when)}
        </span>
        <span className="font-display text-base font-semibold leading-none text-brand">
          {dayFmt(zone).format(when)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-bold leading-snug">{reminder.title}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {formatInTimeZone(reminder.remind_at, zone)} ({timeZoneLabel(zone)})
        </p>
        {reminder.body && <p className="mt-1.5 text-sm text-ink/80">{reminder.body}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {reminder.url && (
            <a
              href={reminder.url}
              target={reminder.url.startsWith('/') ? undefined : '_blank'}
              rel="noreferrer"
              className="text-xs font-bold text-brand"
            >
              Open link ›
            </a>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                aria-label="Edit reminder"
                className="text-xs font-semibold text-muted"
                onClick={onEdit}
              >
                Edit
              </button>
              <button
                type="button"
                aria-label="Delete reminder"
                className="text-xs font-semibold text-brand"
                onClick={onDelete}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      <span className="shrink-0 rounded-full bg-[#F5F1EA] px-2.5 py-1 text-[11px] font-bold text-muted">
        {relativeTime(reminder.remind_at, now)}
      </span>
    </article>
  )
}

/** Already-sent reminder: flat, muted, struck-through — a receipt, not an action. */
function DoneReminderCard({
  reminder,
  canEdit,
  onDelete,
}: {
  reminder: Reminder
  canEdit: boolean
  onDelete: () => void
}) {
  const zone = reminder.time_zone || HOME_TZ
  return (
    <div className="flex items-start justify-between gap-3 rounded-[20px] bg-[#F3EFE8] px-4 py-3.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink/70 line-through">{reminder.title}</p>
        <p className="mt-0.5 text-xs text-muted">
          {formatInTimeZone(reminder.remind_at, zone)} · Sent
        </p>
      </div>
      {canEdit && (
        <button
          type="button"
          aria-label="Delete reminder"
          className="shrink-0 text-xs font-semibold text-muted"
          onClick={onDelete}
        >
          Delete
        </button>
      )}
    </div>
  )
}

interface FormProps {
  initial?: Reminder
  pending: boolean
  error: string | null
  submitLabel: string
  onCancel: () => void
  onSubmit: (input: ReminderInput) => void
}

function ReminderForm({ initial, pending, error, submitLabel, onCancel, onSubmit }: FormProps) {
  const [zone, setZone] = useState(initial?.time_zone || HOME_TZ)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [date, setDate] = useState(() =>
    initial ? instantToWallClock(initial.remind_at, zone).date : todayIn(HOME_TZ)
  )
  const [time, setTime] = useState(() =>
    initial ? instantToWallClock(initial.remind_at, zone).time : '09:00'
  )

  // Israel time by default; Japan (and the phone's own zone, once it is neither)
  // are one tap away. The lines under the chips show the same instant in the
  // zones you did not pick, so a date can't silently land on the wrong day.
  const zones = [HOME_TZ, TOKYO_TZ, deviceTimeZone()].filter(
    (tz, i, list) => list.indexOf(tz) === i
  )
  const preview = date && time ? wallClockToInstant(date, time, zone) : null
  const otherZones = zones.filter((tz) => tz !== zone)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !date || !time) return
    onSubmit({
      title: title.trim(),
      body: body.trim() || null,
      url: url.trim() || null,
      remind_at: wallClockToInstant(date, time, zone).toISOString(),
      time_zone: zone,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label" htmlFor="reminder-title">
          What to do
        </label>
        <input
          id="reminder-title"
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Book the sushi place in Kanazawa"
          maxLength={120}
          required
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="label" htmlFor="reminder-date">
            Date
          </label>
          <input
            id="reminder-date"
            type="date"
            className="field"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="w-32">
          <label className="label" htmlFor="reminder-time">
            Time
          </label>
          <input
            id="reminder-time"
            type="time"
            className="field"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <span className="label">Time zone</span>
        <div className="flex gap-2">
          {zones.map((tz) => (
            <button
              key={tz}
              type="button"
              onClick={() => setZone(tz)}
              className={`chip border ${
                zone === tz ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-white'
              }`}
            >
              {zoneChipLabel(tz)}
            </button>
          ))}
        </div>
        {preview &&
          otherZones.map((tz) => (
            <p key={tz} className="mt-1.5 text-xs text-muted">
              {formatInTimeZone(preview.toISOString(), tz)} in {timeZoneLabel(tz)}
            </p>
          ))}
      </div>

      <div>
        <label className="label" htmlFor="reminder-body">
          Note (optional)
        </label>
        <textarea
          id="reminder-body"
          className="field min-h-20"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Ask for the counter seats, 2 people"
          maxLength={500}
        />
      </div>

      <div>
        <label className="label" htmlFor="reminder-url">
          Link (optional)
        </label>
        <input
          id="reminder-url"
          className="field"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…  (opens when you tap the notification)"
          maxLength={500}
        />
      </div>

      {error && <p className="text-sm font-semibold text-brand">{error}</p>}

      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary flex-1" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

function zoneChipLabel(tz: string): string {
  if (tz === HOME_TZ) return '🇮🇱 Israel'
  if (tz === TOKYO_TZ) return '🇯🇵 Japan'
  return `📍 ${timeZoneLabel(tz)}`
}

/** Today's date (YYYY-MM-DD) as seen in `tz`, for the date input's default. */
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
