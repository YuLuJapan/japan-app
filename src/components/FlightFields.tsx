// The flight section of the trip sheet.
//
// A booking is two directions of the same shape, so this renders one
// <Direction> twice rather than spelling out outbound and return separately.
// Legs are the substance: one leg is a direct flight, and "Add a connection"
// simply appends another — which is why nothing here has a separate notion of
// a connection at all.
//
// Everything is optional. Someone who knows only their flight numbers should
// be able to save them and come back for the times later, so nothing here can
// block Save; the fields the traveller left alone are simply absent from what
// is sent (src/lib/flight-draft.ts).
import { useState } from 'react'
import { commonTimeZones, timeZoneOptions, zoneLabel } from '../lib/flight-time'
import {
  describeDraft,
  emptyLeg,
  isDraftEmpty,
  type DirectionDraft,
  type FlightDraft,
  type LegDraft,
} from '../lib/flight-draft'

const MAX_LEGS = 8

interface Zones {
  common: ReturnType<typeof commonTimeZones>
  all: string[]
}
const field =
  'w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/70'

function Times({
  legend,
  date,
  time,
  tz,
  onChange,
  zones,
}: {
  legend: string
  date: string
  time: string
  tz: string
  onChange: (patch: { date?: string; time?: string; tz?: string }) => void
  zones: Zones
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted">{legend}</p>
      <div className="flex gap-2">
        <input
          type="date"
          aria-label={`${legend} date`}
          className={field}
          value={date}
          onChange={(e) => onChange({ date: e.target.value })}
        />
        <input
          type="time"
          aria-label={`${legend} time`}
          className={field}
          value={time}
          onChange={(e) => onChange({ time: e.target.value })}
        />
      </div>
      <select
        aria-label={`${legend} time zone`}
        className={`${field} mt-2`}
        value={tz}
        onChange={(e) => onChange({ tz: e.target.value })}
      >
        {/* A zone already stored on the trip must stay selectable even if it is
            on neither list, or opening the form would silently move the flight. */}
        {!zones.all.includes(tz) && tz && <option value={tz}>{zoneLabel(tz)}</option>}
        <optgroup label="This trip">
          {zones.common.map((o) => (
            <option key={o.zone} value={o.zone}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="All time zones">
          {zones.all.map((zone) => (
            <option key={zone} value={zone}>
              {zoneLabel(zone)}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  )
}

function Direction({
  label,
  draft,
  onChange,
  zones,
}: {
  label: string
  draft: DirectionDraft
  onChange: (next: DirectionDraft) => void
  zones: Zones
}) {
  const setLeg = (i: number, patch: Partial<LegDraft>) =>
    onChange({ ...draft, legs: draft.legs.map((l, j) => (i === j ? { ...l, ...patch } : l)) })

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-bold text-ink">{label}</legend>

      {draft.legs.map((leg, i) => (
        <div key={i} className="space-y-2 rounded-2xl border border-line/70 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">
              {i === 0 ? 'Flight' : `Connection ${i}`}
            </span>
            {draft.legs.length > 1 && (
              <button
                type="button"
                className="text-xs font-bold text-brand"
                onClick={() => onChange({ ...draft, legs: draft.legs.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            )}
          </div>
          <input
            aria-label={`${label} flight number ${i + 1}`}
            className={field}
            placeholder="Flight number (e.g. ET 419)"
            value={leg.flight_no}
            onChange={(e) => setLeg(i, { flight_no: e.target.value })}
          />
          <div className="flex gap-2">
            <input
              aria-label={`${label} from ${i + 1}`}
              className={field}
              placeholder="From (e.g. TLV)"
              value={leg.from}
              onChange={(e) => setLeg(i, { from: e.target.value })}
            />
            <input
              aria-label={`${label} to ${i + 1}`}
              className={field}
              placeholder="To (e.g. NRT)"
              value={leg.to}
              onChange={(e) => setLeg(i, { to: e.target.value })}
            />
          </div>
        </div>
      ))}

      {draft.legs.length < MAX_LEGS && (
        <button
          type="button"
          className="btn-ghost w-full text-sm"
          onClick={() => onChange({ ...draft, legs: [...draft.legs, emptyLeg()] })}
        >
          + Add a connection
        </button>
      )}

      <Times
        legend={`${label} departure`}
        date={draft.departDate}
        time={draft.departTime}
        tz={draft.departTz}
        zones={zones}
        onChange={(p) =>
          onChange({
            ...draft,
            ...(p.date !== undefined && { departDate: p.date }),
            ...(p.time !== undefined && { departTime: p.time }),
            ...(p.tz !== undefined && { departTz: p.tz }),
          })
        }
      />
      <Times
        legend={`${label} arrival`}
        date={draft.arriveDate}
        time={draft.arriveTime}
        tz={draft.arriveTz}
        zones={zones}
        onChange={(p) =>
          onChange({
            ...draft,
            ...(p.date !== undefined && { arriveDate: p.date }),
            ...(p.time !== undefined && { arriveTime: p.time }),
            ...(p.tz !== undefined && { arriveTz: p.tz }),
          })
        }
      />
    </fieldset>
  )
}

export function FlightFields({
  draft,
  onChange,
}: {
  draft: FlightDraft
  onChange: (next: FlightDraft) => void
}) {
  // Roughly twenty inputs across two directions, and most trips are planned
  // before anything is booked — so this stays shut until asked for. It opens by
  // default only when there is already a booking to edit, since arriving at a
  // collapsed section that silently contains your flights is worse than the
  // extra tap. The draft lives in the sheet above, so collapsing mid-edit
  // keeps whatever has been typed.
  const [open, setOpen] = useState(() => !isDraftEmpty(draft))
  const zones: Zones = { common: commonTimeZones(), all: timeZoneOptions() }
  const summary = describeDraft(draft)

  return (
    <div className="rounded-2xl border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">
            {summary ? 'Flights' : 'Add flight details'}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {summary ?? 'Flight numbers, airports and times — all optional'}
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold text-brand">{open ? 'Hide' : 'Add'}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-3.5 py-3.5">
          <p className="text-xs text-muted">
            Times are optional — the zone is the airport&rsquo;s, so a ticket reads the same on both
            phones.
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Airline"
              className={field}
              placeholder="Airline"
              value={draft.airline}
              onChange={(e) => onChange({ ...draft, airline: e.target.value })}
            />
            <input
              aria-label="Booking reference"
              className={field}
              placeholder="Booking ref"
              value={draft.booking_ref}
              onChange={(e) => onChange({ ...draft, booking_ref: e.target.value })}
            />
          </div>
          <Direction
            label="Outbound"
            draft={draft.outbound}
            zones={zones}
            onChange={(outbound) => onChange({ ...draft, outbound })}
          />
          <Direction
            label="Return"
            draft={draft.return_flight}
            zones={zones}
            onChange={(return_flight) => onChange({ ...draft, return_flight })}
          />
        </div>
      )}
    </div>
  )
}
