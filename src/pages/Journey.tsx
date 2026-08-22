import { Link } from 'react-router-dom'
import { useItinerary, useTrip } from '../api/hooks'
import { CountdownWidget } from '../components/CountdownWidget'
import { ErrorState } from '../components/ErrorState'
import { GenericCountdown } from '../components/GenericCountdown'
import { HeroTitle } from '../components/HeroTitle'
import { JourneyStepsSlider } from '../components/JourneyStepsSlider'
import { Loading } from '../components/Loading'
import { Schedule } from '../components/Schedule'
import { SushiSequence } from '../components/SushiSequence'
import { enumerateDays, toISODate } from '../lib/schedule'
import { useCanEdit, useCanSeeBookings } from '../lib/session'
import { useTripId } from '../lib/trip'

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })

// Only the Japan trip has hero artwork and a real flight booking for now — see
// HEROES-equivalent note in the design prototype. Any other trip skips the
// hero straight to a plain countdown, and shows empty states instead of
// Japan's flight/steps data. Matches by word so "Japan Solo" etc. still count.
const isJapanTrip = (name: string) => /\bjapan\b/i.test(name)

export default function Journey() {
  const canEdit = useCanEdit()
  const canSeeBookings = useCanSeeBookings()
  const tripId = useTripId()
  const { data, isPending, isError, refetch } = useTrip(tripId)
  const itinerary = useItinerary(tripId)

  if (isPending) return <Loading label="Loading the journey…" />
  if (isError) return <ErrorState message="Could not load the trip." onRetry={() => refetch()} />

  const today = new Date()
  const japan = isJapanTrip(data.trip.country ?? data.trip.name ?? '')
  const hasSteps = data.steps.length > 0
  // "Yuval and Luciana in Japan" — composed on the server now (display_title),
  // so every screen and every client agree on what a trip is called. This used
  // to be built here from trip.name plus travellersLabel, which meant the title
  // differed depending on which screen you were looking at.
  const heroTitle = data.trip.display_title
  // Where the trip is going, accented inside that title. HeroTitle only
  // colours it when the composed title actually ends in it, so an explicit
  // name override ("Honeymoon") stays plain.
  const destination = data.trip.country ?? undefined

  return (
    <div className="space-y-6">
      {japan ? (
        <SushiSequence
          title={heroTitle}
          destination={destination}
          meta={`${fmt(data.trip.start_date)} – ${fmt(data.trip.end_date)} · ${data.steps.length} stops`}
        />
      ) : (
        <div>
          <p className="section-title">Our trip</p>
          <HeroTitle title={heroTitle} destination={destination} max={34} className="mt-1" />
          <p className="mt-1.5 text-sm text-muted">
            {fmt(data.trip.start_date)} – {fmt(data.trip.end_date)} · {data.steps.length} stops
          </p>
        </div>
      )}

      {japan && data.flight ? (
        <CountdownWidget flight={data.flight} />
      ) : (
        <GenericCountdown
          startDate={data.trip.start_date}
          // A guest gets no `flight` at all — the bundle withholds it — so don't
          // send them to a Documents tab they don't have either.
          note={canSeeBookings ? undefined : 'The travellers keep the flight details private.'}
        />
      )}

      {hasSteps ? (
        <>
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-2xl font-semibold tracking-tight">The journey</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">swipe →</span>
                {canEdit && (
                  <Link
                    to={`/trips/${tripId}/journey/edit`}
                    className="text-sm font-bold text-brand"
                  >
                    Edit
                  </Link>
                )}
              </div>
            </div>
            <JourneyStepsSlider steps={data.steps} today={today} tripId={tripId} />
          </div>

          <section>
            <h2 className="mb-3 font-display text-2xl font-semibold tracking-tight">Day by day</h2>
            {itinerary.isPending ? (
              <Loading label="Loading the schedule…" />
            ) : itinerary.isError ? (
              <ErrorState
                message="Could not load the schedule."
                onRetry={() => itinerary.refetch()}
              />
            ) : (
              <Schedule
                mode="trip"
                steps={data.steps}
                items={itinerary.data.items}
                days={enumerateDays(data.trip.start_date, data.trip.end_date)}
                today={toISODate(today)}
                tripId={tripId}
              />
            )}
          </section>
        </>
      ) : (
        <div className="rounded-3xl border border-dashed border-line px-5 py-6 text-center">
          <p className="font-display text-base font-semibold">No stops yet</p>
          <p className="mt-1.5 text-sm text-muted">
            Add the cities you&apos;ll sleep in and the day-by-day plan builds itself.
          </p>
          {canEdit && (
            <Link
              to={`/trips/${tripId}/journey/edit`}
              className="btn-primary mt-4 inline-flex px-5"
            >
              + Add a stop
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
