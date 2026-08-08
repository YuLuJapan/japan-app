// Countdown card for a trip with no flight booked yet (anything but the Japan
// trip, until flight data is trip-aware). Counts down to the trip's own
// start_date instead of a real departure time, and explains that a booking
// attached in Documents will upgrade this to the full flight countdown.
import { useEffect, useState } from 'react'
import { timeUntil } from '../lib/countdown'

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

export function GenericCountdown({ startDate, now }: { startDate: string; now?: Date }) {
  const [tick, setTick] = useState(() => now ?? new Date())

  useEffect(() => {
    if (now) return // fixed clock (tests)
    const id = setInterval(() => setTick(new Date()), 1000)
    return () => clearInterval(id)
  }, [now])

  const target = new Date(`${startDate}T09:00:00`)
  const left = timeUntil(target, tick)

  return (
    <div className="relative overflow-hidden rounded-3xl bg-white p-5 shadow-card ring-1 ring-line">
      <div className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full bg-brand/10 blur-3xl" />
      <div className="relative">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">
          {left.done ? 'Under way' : 'Countdown to takeoff'}
        </p>

        {left.done ? (
          <p className="mt-3 font-display text-2xl font-extrabold text-ink">Bon voyage! 🧳</p>
        ) : (
          <div
            className="mt-4 grid grid-cols-4 gap-2"
            role="timer"
            aria-label="Time until the trip starts"
          >
            <Unit value={left.days} label="days" />
            <Unit value={left.hours} label="hrs" />
            <Unit value={left.minutes} label="min" />
            <Unit value={left.seconds} label="sec" />
          </div>
        )}

        <div className="mt-4 border-t border-line pt-3 text-sm text-muted">
          No flights added yet — attach a booking in Documents and the legs show up here.
        </div>
      </div>
    </div>
  )
}
