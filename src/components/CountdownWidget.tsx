// Live countdown to the outbound departure, plus the booking reference and both
// directions of the trip. The two directions share one slot: outbound shows first,
// swipe (or tap the chevron) to reveal the return leg.
// Ticks every second; `now` is injectable for tests.
// Light card: white surface, dark numerals, coral accents.
import { useEffect, useRef, useState, type TouchEvent } from 'react'
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

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={dir === 'right' ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
    </svg>
  )
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-display text-3xl font-bold leading-none tabular-nums text-ink">
        {String(value).padStart(2, '0')}
      </span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
    </div>
  )
}

function Direction({
  label,
  itinerary,
  navDir,
  navLabel,
  onNav,
  active,
}: {
  label: string
  itinerary: FlightItinerary
  navDir: 'left' | 'right'
  navLabel: string
  onNav: () => void
  active: boolean
}) {
  const nav = (
    <button
      type="button"
      onClick={onNav}
      aria-label={navLabel}
      tabIndex={active ? 0 : -1}
      className="rounded-full p-0.5 text-brand transition hover:bg-brand/10 active:scale-95"
    >
      <ChevronIcon dir={navDir} />
    </button>
  )

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          {navDir === 'left' && nav}
          <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
          {navDir === 'right' && nav}
        </span>
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
  const [pane, setPane] = useState(0) // 0 = outbound, 1 = return
  const touchStartX = useRef<number | null>(null)

  useEffect(() => {
    if (now) return // fixed clock (tests)
    const id = setInterval(() => setTick(new Date()), 1000)
    return () => clearInterval(id)
  }, [now])

  const target = new Date(flight.outbound.depart_at)
  const left = timeUntil(target, tick)

  // Swipe: commit once the horizontal drag clears a small threshold.
  const onTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStartX.current
    touchStartX.current = null
    if (start === null) return
    const dx = e.changedTouches[0].clientX - start
    if (Math.abs(dx) < 40) return
    setPane(dx < 0 ? 1 : 0)
  }

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
          <p className="mt-3 font-display text-2xl font-bold text-ink">
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

          <div className="overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div
              className="flex items-start transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${pane * 100}%)` }}
            >
              <div className="w-full shrink-0" aria-hidden={pane !== 0}>
                <Direction
                  label="Outbound"
                  itinerary={flight.outbound}
                  navDir="right"
                  navLabel="Show return flight"
                  onNav={() => setPane(1)}
                  active={pane === 0}
                />
              </div>
              <div className="w-full shrink-0" aria-hidden={pane !== 1}>
                <Direction
                  label="Return"
                  itinerary={flight.return_flight}
                  navDir="left"
                  navLabel="Show outbound flight"
                  onNav={() => setPane(0)}
                  active={pane === 1}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-center gap-1.5">
            {['Outbound', 'Return'].map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => setPane(i)}
                aria-label={`${label} flight`}
                aria-current={pane === i}
                className={`h-1.5 rounded-full transition-all ${
                  pane === i ? 'w-4 bg-brand' : 'w-1.5 bg-line'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
