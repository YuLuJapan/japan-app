// Where the traveller is, as data rather than as exceptions.
//
// The browser's geolocation API answers through a callback pair and reports a
// refusal as an error object, which pushes every branch of FR-022 to FR-025
// into a `catch` and makes "denied" and "the sensor is not there" the same
// shape. They are not the same thing: one the traveller can act on, the other
// they cannot, and the map has to say different words for each.
//
// So the states are a discriminated union and every one of them is a rendered
// case (data-model → `PositionState`). Nothing here throws.
//
// **Nothing here is called on mount** either — that is FR-023's first half and
// it is the caller's rule, not this module's: `requestPosition()` is only
// reached from the locate button. The second half — never re-asking after a
// refusal within the visit — is `shouldAsk()`, which is here because the
// answer belongs with the states rather than with the button.

export type PositionState =
  | { status: 'idle' }
  | { status: 'asking' }
  | { status: 'granted'; lat: number; lng: number; accuracy: number }
  | { status: 'denied' }
  | { status: 'unavailable' }

/** Long enough for a cold GPS fix, short enough not to look stuck. */
const TIMEOUT_MS = 10_000

/** A fix from the last half-minute is a fix; asking again would cost a wait. */
const MAX_AGE_MS = 30_000

/**
 * Ask once, and answer with a state whatever happens.
 *
 * A timeout reads as `unavailable`, not `denied`: the traveller refused
 * nothing, and telling them they did would be a lie they could not correct.
 */
export function requestPosition(): Promise<PositionState> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ status: 'unavailable' })
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          status: 'granted',
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) =>
        resolve(
          // `PERMISSION_DENIED` is 1 and covers a refusal by the traveller *and*
          // a refusal by policy — an insecure context, or a Permissions-Policy
          // header, which is the production-only bug fixed in Slice A.
          error.code === error.PERMISSION_DENIED ? { status: 'denied' } : { status: 'unavailable' }
        ),
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS }
    )
  })
}

/**
 * May the map ask again? Not after a refusal, and not while one is in flight
 * (FR-023). A device with no sensor is not re-asked either — the answer would
 * be the same and the wait would be real.
 */
export const shouldAsk = (state: PositionState): boolean =>
  state.status === 'idle' || state.status === 'granted'

/** What to say about a state that has no position in it. Empty when there is nothing to say. */
export function positionMessage(state: PositionState): string {
  if (state.status === 'denied') return 'Location is off for this site — the map still works.'
  if (state.status === 'unavailable') return 'Your position is unavailable on this device.'
  return ''
}
