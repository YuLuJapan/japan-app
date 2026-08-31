// One category in one city: what is planned under it, then what is saved.
//
// The two bands are deliberately never merged (feature 010, FR-014). A saved
// place is an idea; an activity is a commitment, and it has a day on it. The
// traveller opening "Food" in Tokyo at six in the evening has to be able to
// tell "we already have a day for this" from "somebody liked the look of this
// in March" without reading the schedule on the previous screen and matching
// the two up by name — which is what this page asked of them until now.
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useItinerary, useTrip, useZone, useZonePlaces } from '../api/hooks'
import type { Category } from '../api/types'
import { CATEGORY_META } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { ZoneImage } from '../components/ZoneImage'
import { cityPlan, hiddenCategories, plannedLabel } from '../lib/explore'
import { capture } from '../lib/posthog'
import { enumerateDays, fmtDayLong, fmtTime, zoneDays } from '../lib/schedule'
import { useCanEdit, useTripShows } from '../lib/session'
import { useTripId } from '../lib/trip'

export default function CategoryList() {
  const { zoneId = '', category = '' } = useParams()
  const canEdit = useCanEdit()
  const shows = useTripShows()
  const tripId = useTripId()
  const cat = category as Category
  const zone = useZone(zoneId)
  const { data, isPending, isError, refetch } = useZonePlaces(zoneId, cat)
  const meta = CATEGORY_META[cat] ?? { label: category, icon: '📍' }

  // Both of these are in the cache already in the ordinary path — the city page
  // one tap back fetched them for its hero and its schedule (research R1).
  const trip = useTrip(tripId)
  const itinerary = useItinerary(tripId)
  const plan = useMemo(() => {
    if (!trip.data?.trip || !itinerary.data) return null
    const steps = trip.data.steps
    const days = zoneDays(
      steps,
      zoneId,
      enumerateDays(trip.data.trip.start_date, trip.data.trip.end_date)
    )
    return cityPlan(steps, itinerary.data.items, days, zoneId, hiddenCategories(shows))
  }, [trip.data, itinerary.data, zoneId, shows])

  const planned = plan?.byCategory[cat] ?? []

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load places." onRetry={() => refetch()} />

  return (
    <div>
      <Breadcrumbs
        trail={[
          { label: 'Journey', to: `/trips/${tripId}` },
          { label: zone.data?.zone.name ?? 'Zone', to: `/trips/${tripId}/zones/${zoneId}` },
        ]}
      />
      <div className="m-0 mt-2 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">
          <span className="mr-2">{meta.icon}</span>
          {meta.label}
        </h1>
        {canEdit && (
          <Link
            to={`/trips/${tripId}/zones/${zoneId}/places/new?category=${cat}`}
            className="text-sm font-bold text-brand"
          >
            + Add
          </Link>
        )}
      </div>

      {planned.length > 0 && (
        <section className="mt-4" data-testid="planned-band">
          <h2 className="section-title">On the plan</h2>
          <ul className="mt-2 space-y-2">
            {planned.map((a) => (
              <li key={a.id}>
                <Link
                  // An activity that links to a saved place opens it. One that
                  // links to nothing has no page of its own — it exists only as
                  // a row on a day — so it opens the city, where that day's plan
                  // is read and edited (research R5).
                  to={
                    a.place_id
                      ? `/trips/${tripId}/places/${a.place_id}`
                      : `/trips/${tripId}/zones/${zoneId}`
                  }
                  onClick={() =>
                    capture('explore_planned_opened', {
                      category: cat,
                      source: 'card',
                      planned_count: planned.length,
                    })
                  }
                  className="flex items-baseline gap-3 rounded-2xl bg-sand px-3 py-2.5 active:scale-[0.99]"
                >
                  <span className="shrink-0 text-[11px] font-bold text-muted">
                    {fmtDayLong(a.day)} · {a.start_time ? fmtTime(a.start_time) : 'Anytime'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                    {a.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The heading only appears once there is a second band to tell it from —
          a category with nothing planned reads exactly as it did before. */}
      {planned.length > 0 && <h2 className="section-title mt-5">Saved</h2>}

      {data.places.length === 0 ? (
        <EmptyState
          message={
            // The API sends a restricted caller no stays at all, so an empty
            // list here would read as "nothing booked" rather than "not shared".
            cat === 'hotel' && !shows.stays
              ? 'The travellers keep the stays private.'
              : `Nothing saved under ${meta.label.toLowerCase()} here yet.`
          }
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {data.places.map((p) => {
            const when = plannedLabel(plan?.byPlace.get(p.id))
            return (
              <li key={p.id}>
                <Link
                  to={`/trips/${tripId}/places/${p.id}`}
                  className="card flex items-stretch gap-3 overflow-hidden active:scale-[0.99]"
                >
                  <ZoneImage
                    src={p.image_url}
                    alt={p.name}
                    icon={meta.icon}
                    className="h-24 w-24 shrink-0"
                  />
                  <div className="min-w-0 flex-1 py-3 pr-3">
                    <p className="truncate font-bold">{p.name}</p>
                    {p.summary_line && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted">{p.summary_line}</p>
                    )}
                    {/* "We already have a day for this" — the whole reason the
                        page needed the plan (FR-011). */}
                    {when && (
                      <p className="mt-1.5 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold text-brand">
                        {when}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
