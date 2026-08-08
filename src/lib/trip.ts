// Every "inside a trip" screen lives under /trips/:tripId/* — this just reads
// that param, the same way Zone.tsx reads :zoneId. No context/provider needed
// since it's already in the URL.
import { useParams } from 'react-router-dom'

export function useTripId(): string {
  const { tripId } = useParams<{ tripId: string }>()
  return tripId!
}
