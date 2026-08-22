// Every "inside a trip" screen lives under /trips/:tripId/* — this just reads
// that param, the same way Zone.tsx reads :zoneId. No context/provider needed
// since it's already in the URL.
//
// `travellersLabel` used to live here, building "Yuval & Luciana" so Journey
// could compose a hero title. Titles are computed on the server now and travel
// as `display_title` (server/src/lib/trip-title.ts), which is what stops two
// screens disagreeing about what a trip is called.
import { useParams } from 'react-router-dom'
import type { Trip } from '../api/types'

export function useTripId(): string {
  const { tripId } = useParams<{ tripId: string }>()
  return tripId!
}

/**
 * What a trip card calls a trip: where it goes, not the whole sentence.
 *
 * `display_title` is the composed sentence ("Yuval and Luciana in Japan") and
 * stays the title on the journey hero, where there is room for it. On a card
 * the travellers are already there as avatars right underneath, so the name
 * override — or, failing that, the destination — is the only part that says
 * anything new. The composed title is kept as a last resort, for a trip with
 * neither a name nor a country.
 */
export function tripLabel(trip: Pick<Trip, 'name' | 'country' | 'display_title'>): string {
  return trip.name?.trim() || trip.country?.trim() || trip.display_title
}
