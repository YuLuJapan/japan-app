// Turning a failed save into one line worth reading. Validation failures carry
// the rule that was broken (a day outside the trip, dates that would strand a
// stop) — that is exactly what the traveller needs to see, so show it verbatim.
// Anything else (network, server) stays a generic "try again".
import { ApiError } from '../api/client'

export function saveErrorMessage(error: unknown, fallback = 'Save failed — try again.'): string {
  if (error instanceof ApiError && error.code === 'VALIDATION')
    return error.details?.[0] ?? fallback
  return fallback
}
