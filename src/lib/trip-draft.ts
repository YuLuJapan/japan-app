// What the trip form refuses to send, and why — as data rather than a disabled
// button.
//
// A disabled Save is a dead end: it states that something is wrong without
// saying what, and it once hid a real bug for exactly that reason (the name
// was in this list despite the label calling it optional, so a trip without
// one could never be created and the form never explained why). Naming each
// blocker instead means a wrong rule shows up as a wrong message.
//
// Only the rules the server actually enforces belong here — the client half of
// collectTripErrors in server/src/services/trips.ts. Anything optional there
// is optional here: the name, the country, the travellers, the start time and
// the flight are all allowed to be empty.
export type TripField = 'start' | 'end' | 'currencies'

/**
 * When a blocker is worth saying out loud.
 *
 * `missing` waits for Save: an untouched form is unfinished, not wrong, and
 * telling someone they have not picked a start date before they have scrolled
 * to the dropdowns is noise. `contradiction` does not wait — both sides are
 * already filled in and they disagree, so the traveller can act on it now and
 * would only be puzzled to see it appear later.
 */
export type TripErrorWhen = 'missing' | 'contradiction'

export interface TripDraftError {
  message: string
  when: TripErrorWhen
}

export interface TripDraftValues {
  /** Joined YYYY-MM-DD, or '' while any of the three dropdowns is unset. */
  startDate: string
  endDate: string
  homeCurrencies: string[]
}

export type TripDraftErrors = Partial<Record<TripField, TripDraftError>>

/**
 * Every blocker at once, keyed by the field it belongs beside.
 *
 * All of them, not just the first — someone who opened the sheet and pressed
 * Save should see everything still in the way in one pass rather than being
 * walked down the form one message at a time. Same reason the services collect
 * their validation errors into one array.
 */
export function collectTripDraftErrors(values: TripDraftValues): TripDraftErrors {
  const errors: TripDraftErrors = {}
  if (!values.startDate)
    errors.start = { message: 'Pick the day, month and year the trip starts.', when: 'missing' }
  if (!values.endDate)
    errors.end = { message: 'Pick the day, month and year the trip ends.', when: 'missing' }
  // Only reachable with both dates complete, which is what makes it a
  // contradiction rather than something still being filled in.
  else if (values.startDate && values.endDate < values.startDate)
    errors.end = { message: 'The end date is before the start date.', when: 'contradiction' }
  if (!values.homeCurrencies.length)
    errors.currencies = {
      message: 'Pick at least one currency to convert to.',
      when: 'missing',
    }
  return errors
}

/** The fields that can carry a message, in the order they appear in the form. */
export const TRIP_FIELD_ORDER: TripField[] = ['start', 'end', 'currencies']

/**
 * One line for the summary above the button: how much is still in the way.
 *
 * Deliberately a count rather than a re-listing — each message is already
 * sitting beside the field it belongs to, and repeating all of them here would
 * put the same sentence on the screen twice.
 */
export function tripErrorSummary(errors: TripDraftErrors): string | null {
  const count = TRIP_FIELD_ORDER.filter((f) => errors[f]).length
  if (!count) return null
  return count === 1
    ? 'One thing still needs fixing before this can be saved.'
    : `${count} things still need fixing before this can be saved.`
}
