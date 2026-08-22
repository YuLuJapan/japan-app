// Every "inside a trip" screen lives under /trips/:tripId/* — this just reads
// that param, the same way Zone.tsx reads :zoneId. No context/provider needed
// since it's already in the URL.
//
// `travellersLabel` used to live here, building "Yuval & Luciana" so Journey
// could compose a hero title. Titles are computed on the server now and travel
// as `display_title` (server/src/lib/trip-title.ts), which is what stops two
// screens disagreeing about what a trip is called.
import { useParams } from 'react-router-dom'

export function useTripId(): string {
  const { tripId } = useParams<{ tripId: string }>()
  return tripId!
}
