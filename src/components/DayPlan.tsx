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
// A day two cities share is drawn as one timeline in bands — the city you came
// from, this city, the city you leave for — so the whole day is readable from
// either city's page, with the half planned in the other one under its name.
//
// Every activity belongs to a city. Usually the screen already knows which —
// a city page pins to itself, the trip screen to the city you sleep in that
// night. On a day two cities share, the trip screen cannot know, so the add
// form asks rather than guessing: `zoneChoices` are the day's cities, and one
// of them has to be picked before the activity can be added.
//
// Editing an activity can also move it to another day, so a plan that shifts by
// a day is a date change rather than a delete-and-retype. The picker is bounded
// by the trip's own dates — the same rule the API enforces.
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTrip } from '../api/hooks'
import {
  useCreateItineraryItem,
  useDeleteItineraryItem,
  useUpdateItineraryItem,
} from '../api/mutations'
import {
  CATEGORY_META,
  TAGGABLE_CATEGORIES,
  type Category,
  type ItineraryItem,
  type ZoneSummary,
} from '../api/types'
import { saveErrorMessage } from '../lib/errors'
import { type DaySection, fmtDayLong } from '../lib/schedule'
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
  /**
   * The day's activities in the bands the page shows them in — one on an ordinary
   * day, and on a moving day one per city the day is shared with (see `daySections`).
   */
  sections: DaySection[]
  /** City this day belongs to; new items are tagged with it. */
  zoneId?: string | null
  /**
   * The cities to choose between when the screen cannot tell which one a new activity
   * belongs to — the trip screen on a day two cities share. Empty or absent everywhere
   * else, where `zoneId` already answers it.
   */
  zoneChoices?: ZoneSummary[]
  tripId: string
}

export function DayPlan({ day, sections, zoneId = null, zoneChoices, tripId }: Props) {
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

  // An empty band needs no heading, so it is dropped; `offsets` is where each of the
  // rest starts in the day, which is what keeps the numbering continuous across them.
  const bands = sections.filter((s) => s.items.length > 0)
  const offsets = bands.map((_, i) =>
    bands.slice(0, i).reduce((n, band) => n + band.items.length, 0)
  )
  const count = bands.reduce((n, band) => n + band.items.length, 0)

  // One activity, at its place in the day: `i` counts across every band, so the
  // coral "the day starts here" dot lands on the day's first activity even when
  // that activity is in the city you are about to leave.
  const renderItem = (item: ItineraryItem, i: number) => {
    // The traveller's own tag wins over the one derived from a linked
    // place: if they typed one, they meant it. A withheld stay leaves
    // both null, so this cannot put back what the view took away.
    const tag = item.category ?? item.place_category ?? null
    return editingId === item.id ? (
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
            className={`w-16 shrink-0 text-xs ${
              i === 0 ? 'font-bold text-brand' : 'font-semibold text-faint'
            }`}
          >
            {item.start_time ? fmtTime(item.start_time) : 'Anytime'}
          </span>
          <p className="min-w-0 flex-1 text-base font-bold leading-snug text-ink">{item.title}</p>
        </div>
        <div className="ml-[76px]">
          {item.note && <p className="mt-1 text-xs leading-relaxed text-[#8A8478]">{item.note}</p>}
          {/* Boolean, not the raw length: `null || 0` is `0`, and React
                  renders a bare 0 as text — an untagged activity printed a
                  stray "0" under its title. */}
          {!!(tag || item.place_files?.length) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {tag && (
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${CATEGORY_META[tag].color}`}
                >
                  {CATEGORY_META[tag].icon} {CATEGORY_META[tag].label}
                </span>
              )}
              {item.place_files?.map((name) => (
                <span
                  key={name}
                  className="max-w-[180px] truncate rounded-full bg-sand px-2.5 py-1 text-[11px] font-semibold text-slate"
                >
                  📎 {name}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-3 text-xs font-semibold">
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
                <button type="button" className="text-muted" onClick={() => setEditingId(item.id)}>
                  Edit
                </button>
                <button type="button" className="text-brand" onClick={() => setDeletingId(item.id)}>
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </li>
    )
  }

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

      {count === 0 && !adding ? (
        <EmptyState message="Nothing planned for this day yet." />
      ) : (
        // The rail is an absolutely positioned line rather than the list's own
        // left border, so it starts where "Plan" starts instead of 18px inside
        // it, and so the dots can straddle it. Design 1g: line at x=3px,
        // 1.5px wide; dots 8px at x=0, which centres them on it.
        <ol className="relative pl-[18px]">
          <span
            aria-hidden
            className="absolute bottom-[5px] left-[3px] top-[5px] w-[1.5px] rounded bg-line"
          />
          {bands.map((band, bi) => (
            <Fragment key={band.zone?.id ?? 'here'}>
              {band.zone && (
                <li className="relative pb-4" data-testid="day-band">
                  {/* A hollow dot, not a filled one: the rail runs on through the
                      move, but nothing is planned at the point of it. */}
                  <span
                    aria-hidden
                    className="absolute -left-[18px] top-[5px] h-2 w-2 rounded-full border-[1.5px] border-dust bg-canvas"
                  />
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">
                    {band.direction === 'before' ? 'Earlier that day, in ' : 'Later that day, in '}
                    {band.zone.name}
                  </p>
                </li>
              )}
              {band.items.map((item, k) => renderItem(item, offsets[bi] + k))}
            </Fragment>
          ))}
        </ol>
      )}

      {adding && (
        <div className="mt-2 rounded-2xl border border-line bg-white p-3">
          <ItemForm
            zoneChoices={zoneChoices}
            pending={create.isPending}
            error={create.error}
            submitLabel="Add"
            onCancel={() => setAdding(false)}
            onSubmit={({ zone_id, ...input }) =>
              create.mutate(
                { ...input, day, zone_id: zone_id ?? zoneId },
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
  category: Category | null
  /** Only sent when editing moved the activity to another day. */
  day?: string
  /** The city picked on a day the screen could not pick one for. */
  zone_id?: string
}

function ItemForm({
  initial,
  day,
  tripRange,
  zoneChoices,
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
  /** Cities to choose between; absent when the screen already knows the city. */
  zoneChoices?: ZoneSummary[]
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
  const [category, setCategory] = useState<Category | null>(initial?.category ?? null)
  // Nothing is preselected: a default here is exactly the guess this field exists to
  // stop, and the traveller would leave it where it was found.
  const [zone, setZone] = useState<string | null>(null)

  // Moving is offered when editing an existing activity, not when adding one to
  // the day you are already looking at.
  const canMove = !!initial && !!tripRange
  const choices = zoneChoices ?? []
  const needsZone = choices.length > 0 && !zone

  const submit = () => {
    if (!title.trim() || needsZone) return
    onSubmit({
      title: title.trim(),
      start_time: time || null,
      note: note.trim() || null,
      category,
      ...(canMove && date && date !== initial.day ? { day: date } : {}),
      ...(zone ? { zone_id: zone } : {}),
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
      {/* On a day that belongs to two cities the screen has no basis for picking
          one, so it asks — and Add stays disabled until it is answered, because a
          silent default is the guess this replaced. */}
      {choices.length > 0 && (
        <fieldset>
          <legend className="label">Which city is this in?</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {choices.map((z) => {
              const on = zone === z.id
              return (
                <button
                  key={z.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setZone(z.id)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                    on ? 'bg-brand text-white' : 'bg-sand text-slate opacity-70'
                  }`}
                >
                  {z.name}
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      {/* Toggles, not a select: there are four, they are the colours the plan
          already speaks, and tapping the chosen one again clears it — which is
          the only way back to "no tag" once one is set. */}
      <fieldset>
        <legend className="label">Tag</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {TAGGABLE_CATEGORIES.map((c) => {
            const on = category === c
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => setCategory(on ? null : c)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                  on ? CATEGORY_META[c].color : 'bg-sand text-slate opacity-70'
                }`}
              >
                {CATEGORY_META[c].icon} {CATEGORY_META[c].label}
              </button>
            )
          })}
        </div>
      </fieldset>
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
        <button
          type="button"
          className="btn-primary flex-1"
          onClick={submit}
          disabled={pending || needsZone}
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
