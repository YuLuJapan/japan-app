import { useTrip } from '../api/hooks'
import type { MapCity } from '../components/TripMap'
import { ErrorState } from '../components/ErrorState'
import { JourneyStepsSlider, stepStatus } from '../components/JourneyStepsSlider'
import { Loading } from '../components/Loading'
import { TripMap } from '../components/TripMap'

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })

export default function Journey() {
  const { data, isPending, isError, refetch } = useTrip()

  if (isPending) return <Loading label="Loading the journey…" />
  if (isError) return <ErrorState message="Could not load the trip." onRetry={() => refetch()} />

  // One pin per city, numbered by first visit; mark the city of the current stop.
  const today = new Date()
  const cities: MapCity[] = []
  const seen = new Set<string>()
  data.steps.forEach((step) => {
    const z = step.zone
    if (!z || z.lat == null || z.lng == null || seen.has(z.id)) return
    seen.add(z.id)
    cities.push({
      id: z.id,
      name: z.name,
      lat: z.lat,
      lng: z.lng,
      order: cities.length + 1,
      current: stepStatus(step, today) === 'current',
    })
  })

  return (
    <div className="space-y-6">
      <div>
        <p className="section-title text-brand">Our trip</p>
        <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">{data.trip.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {fmt(data.trip.start_date)} – {fmt(data.trip.end_date)} · {data.steps.length} stops
        </p>
      </div>

      <div className="h-64 overflow-hidden rounded-3xl shadow-card ring-1 ring-line">
        <TripMap cities={cities} />
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-extrabold">The journey</h2>
          <span className="text-xs text-muted">swipe →</span>
        </div>
        <JourneyStepsSlider steps={data.steps} today={today} />
      </div>
    </div>
  )
}
