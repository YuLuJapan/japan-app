// Turning a failed save into one line worth reading. Validation failures carry
// the rule that was broken (a day outside the trip, dates that would strand a
// stop) — that is exactly what the traveller needs to see, so show it verbatim.
// Anything else (network, server) stays a generic "try again".
import { ApiError } from '../api/client'

/**
 * The server names the field that broke the rule, and it names it the way the
 * API does — `start_date`, `end_date`, `zone_id`. That is right for the wire
 * and wrong for a phone screen, where it reads like a leaked variable name.
 * Every such token is a field name, so spacing them out is safe and needs no
 * per-field table: "end_date must be on or after start_date" becomes "end date
 * must be on or after start date".
 *
 * Only the underscores go — the first letter is left alone, because these
 * messages are shown mid-sentence next to labels that already carry the
 * capital.
 */
const humanizeFieldNames = (message: string) =>
  message.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (field) => field.replace(/_/g, ' '))

export function saveErrorMessage(error: unknown, fallback = 'Save failed — try again.'): string {
  if (error instanceof ApiError && error.code === 'VALIDATION') {
    const detail = error.details?.[0]
    return detail ? humanizeFieldNames(detail) : fallback
  }
  return fallback
}
