// Trip-scoped API paths.
//
// Every content route on the API now lives under /api/trips/:tripId, behind a
// single membership check (server/src/lib/trip-context.ts). The client has to
// match, and the trip id is not something these hooks need passed to them: the
// router already nests every screen that calls them under /trips/:tripId, so
// the id is in the URL by construction.
//
// Reading it here rather than threading it through 26 hook signatures keeps
// the call sites unchanged — and reflects the truth that the trip is ambient
// in this UI, not an argument someone chooses.
import { useParams } from 'react-router-dom'

/** The trip in the current URL. Empty outside a /trips/:tripId route. */
export const useTripId = (): string => useParams<{ tripId: string }>().tripId ?? ''

/**
 * Prefixes an API path with the current trip.
 *
 * `tripPath('/places/abc')` → `/trips/trip-1/places/abc`
 */
export function useTripPath(): (suffix: string) => string {
  const tripId = useTripId()
  return (suffix: string) => {
    // Loud rather than silently building `/trips//places/abc`, which would
    // reach the API as an unrelated 404 and send whoever debugs it looking in
    // the wrong place. If this throws, the component was rendered outside a
    // /trips/:tripId route.
    if (!tripId) throw new Error(`No trip in the URL — cannot build a path for ${suffix}`)
    return `/trips/${tripId}${suffix}`
  }
}
