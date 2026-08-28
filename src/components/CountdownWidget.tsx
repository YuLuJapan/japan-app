// Live countdown to the outbound departure, over a card that holds the booking
// reference and every leg of the trip (redesign options 1e/1f).
//
// The card has two states. Collapsed — the default — is four big numerals and
// one muted line; that is what someone glancing at the trip screen wants, and
// it keeps the journey cards above the fold. Tapping it expands the booking
// reference and both directions, and tapping again puts them away.
//
// The two directions are stacked rather than swiped between. The card used to
// carry them as a two-pane carousel, which hid the return flight behind a
// gesture nobody was told about; once the details are behind a disclosure
// anyway, there is room to simply print both.
//
// Ticks every second; `now` is injectable for tests.
import { useEffect, useState } from 'react'
import type { FlightInfo, FlightItinerary } from '../api/types'
import { timeUntil } from '../lib/countdown'

// Always render the ticket's local time, whatever zone the phone is in.
const fmtAt = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('en', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  })

function PlaneIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  )
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl bg-sand px-1 py-2.5 text-center">
      <div className="font-display text-[28px] font-extrabold leading-none tabular-nums text-graphite">
        {String(value).padStart(2, '0')}
      </div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-faint">{label}</div>
    </div>
  )
}

/** One direction of the booking: its departure, its legs, and where it lands. */
function Direction({ label, itinerary }: { label: string; itinerary: FlightItinerary }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-brand">
          {label}
        </span>
        {itinerary.depart_at && itinerary.depart_tz && (
          <span className="text-xs font-semibold text-ink">
            {fmtAt(itinerary.depart_at, itinerary.depart_tz)}
          </span>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {itinerary.legs.map((leg) => (
          <div key={leg.flight_no} className="flex items-center gap-2">
            <span className="shrink-0 rounded-[7px] bg-blush px-1.5 py-0.5 text-[10px] font-bold text-brand">
              {leg.flight_no}
            </span>
            <span className="text-xs text-graphite">
              {leg.from} → {leg.to}
            </span>
          </div>
        ))}
      </div>
      {itinerary.arrive_at && itinerary.arrive_tz && (
        <p className="mt-2 text-[11px] text-faint">
          Lands {fmtAt(itinerary.arrive_at, itinerary.arrive_tz)}
        </p>
      )}
    </div>
  )
}

export function CountdownWidget({ flight, now }: { flight: FlightInfo; now?: Date }) {
  const [tick, setTick] = useState(() => now ?? new Date())
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (now) return // fixed clock (tests)
    const id = setInterval(() => setTick(new Date()), 1000)
    return () => clearInterval(id)
  }, [now])

  // A booking recorded as flight numbers and airports, with the times left for
  // later, is a perfectly ordinary state — the card then shows the flights and
  // simply has nothing to count down to.
  const directions = [
    { label: 'Outbound', itinerary: flight.outbound },
    { label: 'Return', itinerary: flight.return_flight },
  ].filter((d): d is { label: string; itinerary: FlightItinerary } => !!d.itinerary)
  const departAt = flight.outbound?.depart_at
  const left = timeUntil(new Date(departAt ?? 0), tick)

  return (
    <div className="rounded-[26px] bg-white p-5 shadow-pop">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-brand">
          <PlaneIcon />
          <span className="text-xs font-extrabold uppercase tracking-[0.1em]">
            {!departAt ? 'Your flights' : left.done ? 'Takeoff' : 'Countdown to takeoff'}
          </span>
        </span>
        <span
          aria-hidden
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition ${
            open ? 'bg-blush text-brand' : 'text-hush'
          }`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${open ? '' : 'rotate-180'}`}
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </span>
      </button>

      {!departAt ? null : left.done ? (
        <p className="mt-3 font-display text-2xl font-bold text-ink">
          Bon voyage — you&apos;re on your way! 🎌
        </p>
      ) : (
        <div
          className="mt-3.5 grid grid-cols-4 gap-1.5"
          role="timer"
          aria-label="Time until departure"
        >
          <Unit value={left.days} label="days" />
          <Unit value={left.hours} label="hrs" />
          <Unit value={left.minutes} label="min" />
          <Unit value={left.seconds} label="sec" />
        </div>
      )}

      {open ? (
        <div className="mt-4 space-y-3 border-t border-line pt-3.5">
          {flight.booking_ref && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Booking ref</span>
              <span className="font-mono text-xs font-bold tracking-[0.1em] text-ink">
                {flight.booking_ref}
              </span>
            </div>
          )}
          {directions.map((d) => (
            <Direction key={d.label} label={d.label} itinerary={d.itinerary} />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3.5 flex items-center gap-1.5 text-xs text-[#8A8478]"
        >
          Tap here to see the flight details
          <span aria-hidden className="text-brand">
            ›
          </span>
        </button>
      )}
    </div>
  )
}
