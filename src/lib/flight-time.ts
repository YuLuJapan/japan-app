// Ticket times, between the form and the wire.
//
// A flight time is written on the ticket in the airport's own local time —
// "15:35 from TLV" — but stored as an absolute instant plus the zone it was
// written in, so it renders identically on a phone still set to Israel and one
// already switched to Tokyo. That means the form has to convert both ways.
//
// The awkward direction is local → instant: "15:35 on 2026-09-18 in
// Asia/Jerusalem" is a different instant depending on whether DST was in
// effect, and there is no built-in for it. Intl can only go the other way, so
// this guesses an instant, asks Intl what that guess reads as locally, and
// corrects by the difference — twice, because a guess that lands on the far
// side of a DST change gets the wrong offset on the first pass.

const PARTS = {
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
} as const

function readInZone(instant: number, tz: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...PARTS }).formatToParts(
    new Date(instant)
  )
  const out: Record<string, number> = {}
  for (const { type, value } of parts) if (type !== 'literal') out[type] = Number(value)
  // Some runtimes render midnight as hour 24 under hour12: false.
  if (out.hour === 24) out.hour = 0
  return out
}

/** How far `tz` is from UTC at this instant, in milliseconds. */
function offsetAt(instant: number, tz: string): number {
  const p = readInZone(instant, tz)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant
}

/**
 * "2026-09-18" + "15:35" as read in `tz` → the ISO instant to store.
 * Returns null for input the form hasn't finished filling in.
 */
export function zonedToInstant(date: string, time: string, tz: string): string | null {
  if (!date || !time || !tz) return null
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  if ([y, mo, d, h, mi].some((n) => !Number.isFinite(n))) return null
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  try {
    // First pass uses the offset in force at the *naive* instant, which is off
    // by an hour when the true instant sits on the other side of a DST change;
    // the second pass re-reads the offset at that corrected instant.
    const once = naive - offsetAt(naive, tz)
    const twice = naive - offsetAt(once, tz)
    return new Date(twice).toISOString()
  } catch {
    return null // unknown zone
  }
}

/** The stored instant back as the form's two fields, read in `tz`. */
export function instantToZoned(instant?: string, tz?: string): { date: string; time: string } {
  if (!instant || !tz) return { date: '', time: '' }
  const ms = Date.parse(instant)
  if (Number.isNaN(ms)) return { date: '', time: '' }
  try {
    const p = readInZone(ms, tz)
    const pad = (n: number) => String(n).padStart(2, '0')
    return {
      date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
      time: `${pad(p.hour)}:${pad(p.minute)}`,
    }
  } catch {
    return { date: '', time: '' }
  }
}

/** This device's zone — the only defensible default for a time being typed in. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Every zone this browser knows, for the picker.
 *
 * `supportedValuesOf` is the whole IANA list and needs no curating; where it is
 * missing, a hand-written shortlist keeps the field usable rather than empty.
 */
export function timeZoneOptions(): string[] {
  const withDevice = (list: string[]) =>
    [...new Set([deviceTimeZone(), ...list])].filter(Boolean).sort()
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.('timeZone')
    if (supported?.length) return withDevice(supported)
  } catch {
    /* fall through to the shortlist */
  }
  return withDevice([
    'UTC',
    'Asia/Jerusalem',
    'Asia/Tokyo',
    'Africa/Addis_Ababa',
    'Europe/London',
    'Europe/Paris',
    'America/New_York',
    'America/Los_Angeles',
  ])
}
