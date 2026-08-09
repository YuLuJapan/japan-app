// Every "inside a trip" screen lives under /trips/:tripId/* — this just reads
// that param, the same way Zone.tsx reads :zoneId. No context/provider needed
// since it's already in the URL.
import { useParams } from 'react-router-dom'
import type { Traveller } from '../api/types'

export function useTripId(): string {
  const { tripId } = useParams<{ tripId: string }>()
  return tripId!
}

/** "Yuval & Luciana" from the trip's travellers — up to the first two, like the
 *  design prototype's travellersLabel. Falls back to "Our trip" with none set. */
export function travellersLabel(people: Traveller[]): string {
  return people.length ? people.slice(0, 2).map((p) => p.name).join(' & ') : 'Our trip'
}
