// The script. One source for the voiceover *and* the burned-in captions, so
// the two can never disagree — which is the usual way a "works muted" video
// stops working muted.
//
// `seconds` is when the line starts. The last entry's `seconds + hold` is the
// end of the video, so retiming is a matter of editing this table.
import { FPS } from './theme.ts'

export interface Line {
  /** Spoken, and shown. Kept short: a caption is read in one glance. */
  text: string
  /** The screen behind it, from public/screens. `null` = no phone, type only. */
  screen: string | null
  seconds: number
  /**
   * Which part of the tall screenshot to sit on. 0 = top, 1 = bottom. Most
   * screens are longer than the frame, so this is what picks the good bit.
   */
  focus?: number
  /** A short label pinned to the phone, for the thing the line is about. */
  pin?: string
}

export const SCRIPT: Line[] = [
  { text: 'Planning a trip to Japan takes about six different apps.', screen: null, seconds: 0 },
  { text: 'Onward is one.', screen: null, seconds: 4.2 },
  { text: 'Every trip you are planning, in one place.', screen: 'trips', seconds: 6.6, focus: 0 },
  {
    text: 'The whole journey — ten cities, in the order you will see them.',
    screen: 'journey',
    seconds: 11.4,
    focus: 0,
  },
  {
    text: 'Open a city for what to see, where to eat, and what you saved.',
    screen: 'zone',
    seconds: 17.2,
    focus: 0.15,
  },
  {
    text: 'A day-by-day plan that knows your dates.',
    screen: 'schedule',
    seconds: 23.2,
    focus: 0.2,
  },
  {
    text: 'A shopping list for the things you only get there.',
    screen: 'shopping',
    seconds: 27.6,
    focus: 0.1,
  },
  {
    text: 'And reminders that reach the people on the trip, and nobody else.',
    screen: 'reminders',
    seconds: 32,
    focus: 0.05,
  },
  {
    text: 'Share it with whoever is coming.',
    screen: 'members',
    seconds: 37.4,
    focus: 0,
    pin: 'Owner · Partner · View only',
  },
  {
    text: 'And choose exactly what each of them can see.',
    screen: 'members',
    seconds: 41,
    focus: 0.28,
    pin: 'Stays · Flights · Documents',
  },
  {
    text: 'Your bookings and documents stay yours until you say otherwise.',
    screen: 'documents',
    seconds: 45.4,
    focus: 0,
  },
  { text: 'Onward. Your whole trip, in one place.', screen: null, seconds: 50.4 },
]

/** How long the closing card holds after its line, in seconds. */
export const OUTRO_HOLD = 4.4

export const lineStart = (i: number) => Math.round(SCRIPT[i].seconds * FPS)
export const lineEnd = (i: number) =>
  i === SCRIPT.length - 1
    ? Math.round((SCRIPT[i].seconds + OUTRO_HOLD) * FPS)
    : lineStart(i + 1)

export const DURATION = lineEnd(SCRIPT.length - 1)
