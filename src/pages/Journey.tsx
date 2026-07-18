import { Link } from 'react-router-dom'
import { useItinerary, useTrip } from '../api/hooks'
import type { MapCity } from '../components/TripMap'
import { CountdownWidget } from '../components/CountdownWidget'
import { ErrorState } from '../components/ErrorState'
import { JourneyStepsSlider, stepStatus } from '../components/JourneyStepsSlider'
import { Loading } from '../components/Loading'
import { Schedule } from '../components/Schedule'
import { TripMap } from '../components/TripMap'
import { enumerateDays, toISODate } from '../lib/schedule'

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })

export default function Journey() {
  const { data, isPending, isError, refetch } = useTrip()
  const itinerary = useItinerary()

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

      {data.flight && <CountdownWidget flight={data.flight} />}

      <div className="h-64 overflow-hidden rounded-3xl shadow-card ring-1 ring-line">
        <TripMap cities={cities} />
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-extrabold">The journey</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">swipe →</span>
            <Link to="/journey/edit" className="text-sm font-bold text-brand">
              Edit
            </Link>
          </div>
        </div>
        <JourneyStepsSlider steps={data.steps} today={today} />
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-extrabold">Day by day</h2>
        {itinerary.isPending ? (
          <Loading label="Loading the schedule…" />
        ) : itinerary.isError ? (
          <ErrorState message="Could not load the schedule." onRetry={() => itinerary.refetch()} />
        ) : (
          <Schedule
            mode="trip"
            steps={data.steps}
            items={itinerary.data.items}
            days={enumerateDays(data.trip.start_date, data.trip.end_date)}
            today={toISODate(today)}
          />
        )}
      </section>
    </div>
  )
}
