// Live countdown to the outbound departure, plus the booking reference and both
// directions of the trip. Ticks every second; `now` is injectable for tests.
// Light card: white surface, dark numerals, coral accents.
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
      width="16"
      height="16"
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
    <div className="flex flex-col items-center">
      <span className="font-display text-3xl font-extrabold leading-none tabular-nums text-ink">
        {String(value).padStart(2, '0')}
      </span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
    </div>
  )
}

function Direction({ label, itinerary }: { label: string; itinerary: FlightItinerary }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
        <span className="font-semibold text-ink">
          {fmtAt(itinerary.depart_at, itinerary.depart_tz)}
        </span>
      </div>
      <div className="mt-1">
        {itinerary.legs.map((leg) => (
          <div key={leg.flight_no} className="flex items-center gap-2 py-0.5">
            <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-xs font-bold text-brand">
              {leg.flight_no}
            </span>
            <span className="text-ink">
              {leg.from} → {leg.to}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Lands {fmtAt(itinerary.arrive_at, itinerary.arrive_tz)}</p>
    </div>
  )
}

export function CountdownWidget({ flight, now }: { flight: FlightInfo; now?: Date }) {
  const [tick, setTick] = useState(() => now ?? new Date())

  useEffect(() => {
    if (now) return // fixed clock (tests)
    const id = setInterval(() => setTick(new Date()), 1000)
    return () => clearInterval(id)
  }, [now])

  const target = new Date(flight.outbound.depart_at)
  const left = timeUntil(target, tick)

  return (
    <div className="relative overflow-hidden rounded-3xl bg-white p-5 shadow-card ring-1 ring-line">
      {/* whisper of brand warmth in the corner */}
      <div className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full bg-brand/10 blur-3xl" />

      <div className="relative">
        <div className="flex items-center gap-2 text-brand">
          <PlaneIcon />
          <p className="text-xs font-bold uppercase tracking-wide">
            {left.done ? 'Takeoff' : 'Countdown to takeoff'}
          </p>
        </div>

        {left.done ? (
          <p className="mt-3 font-display text-2xl font-extrabold text-ink">
            Bon voyage — you're on your way! 🎌
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-4 gap-2" role="timer" aria-label="Time until departure">
            <Unit value={left.days} label="days" />
            <Unit value={left.hours} label="hrs" />
            <Unit value={left.minutes} label="min" />
            <Unit value={left.seconds} label="sec" />
          </div>
        )}

        <div className="mt-4 space-y-3 border-t border-line pt-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">Booking ref</span>
            <span className="font-mono font-bold tracking-widest text-ink">{flight.booking_ref}</span>
          </div>
          <Direction label="Outbound" itinerary={flight.outbound} />
          <Direction label="Return" itinerary={flight.return_flight} />
        </div>
      </div>
    </div>
  )
}
