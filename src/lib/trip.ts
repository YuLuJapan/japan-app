// Every "inside a trip" screen lives under /trips/:tripId/* — this just reads
// that param, the same way Zone.tsx reads :zoneId. No context/provider needed
// since it's already in the URL.
import { useParams } from 'react-router-dom'
import type { Traveller } from '../api/types'

export function useTripId(): string {
  const { tripId } = useParams<{ tripId: string }>()
  return tripId!
}

/** "Yuval & Luciana", or "Yuval, Luciana & Noa" for three or more — every
 *  traveller's name, comma-separated with "&" before the last one. Falls back
 *  to "Our trip" when none are set. */
export function travellersLabel(people: Traveller[]): string {
  const names = people.map((p) => p.name).filter(Boolean)
  if (names.length === 0) return 'Our trip'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}
