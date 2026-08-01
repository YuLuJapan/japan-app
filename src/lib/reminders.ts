// Pure date/timezone math for reminders, kept out of the component so it can be
// tested. Reminders are stored as absolute instants; the UI lets you pick the
// wall clock in either the phone's zone or Japan's, which is the whole point —
// "9am in Japan" must mean the same moment from Tel Aviv.
export const TOKYO_TZ = 'Asia/Tokyo'

export const deviceTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/** How far `tz` is ahead of UTC (ms) at a given instant — DST-correct. */
function timeZoneOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour') % 24, // some locales render midnight as 24
    at('minute'),
    at('second')
  )
  return asUtc - date.getTime()
}

/**
 * "2026-09-12" + "09:00" in Asia/Tokyo → the matching UTC instant.
 * Two passes so the offset is read at the resulting instant, not the guess
 * (matters on the hours around a DST change).
 */
export function wallClockToInstant(date: string, time: string, tz: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  let ms = guess - timeZoneOffsetMs(new Date(guess), tz)
  ms = guess - timeZoneOffsetMs(new Date(ms), tz)
  return new Date(ms)
}

/** Inverse of wallClockToInstant — fills the date/time inputs when editing. */
export function instantToWallClock(iso: string, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso))
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  const hour = at('hour') === '24' ? '00' : at('hour')
  return { date: `${at('year')}-${at('month')}-${at('day')}`, time: `${hour}:${at('minute')}` }
}

export function formatInTimeZone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

/** Short zone label for a chip: "Asia/Tokyo" → "Tokyo". */
export const timeZoneLabel = (tz: string): string => tz.split('/').pop()?.replace(/_/g, ' ') ?? tz

/** "in 3 days" / "in 2 hours" / "5 minutes ago" — relative to `now`. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime()
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ]
  for (const [unit, ms] of units) {
    const value = Math.trunc(diffMs / ms)
    if (Math.abs(value) >= 1) return rtf.format(value, unit)
  }
  return 'now'
}
