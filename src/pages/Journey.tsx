import { Link } from 'react-router-dom'
import { useItinerary, useTrip } from '../api/hooks'
import { CountdownWidget } from '../components/CountdownWidget'
import { ErrorState } from '../components/ErrorState'
import { JourneyStepsSlider } from '../components/JourneyStepsSlider'
import { Loading } from '../components/Loading'
import { Schedule } from '../components/Schedule'
import { SushiSequence } from '../components/SushiSequence'
import { enumerateDays, toISODate } from '../lib/schedule'
import { useCanEdit } from '../lib/session'

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })

export default function Journey() {
  const canEdit = useCanEdit()
  const { data, isPending, isError, refetch } = useTrip()
  const itinerary = useItinerary()

  if (isPending) return <Loading label="Loading the journey…" />
  if (isError) return <ErrorState message="Could not load the trip." onRetry={() => refetch()} />

  const today = new Date()

  return (
    <div className="space-y-6">
      <SushiSequence
        title={data.trip.name}
        meta={`${fmt(data.trip.start_date)} – ${fmt(data.trip.end_date)} · ${data.steps.length} stops`}
      />

      {data.flight && <CountdownWidget flight={data.flight} />}

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-extrabold">The journey</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">swipe →</span>
            {canEdit && (
              <Link to="/journey/edit" className="text-sm font-bold text-brand">
                Edit
              </Link>
            )}
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
