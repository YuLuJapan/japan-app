import { Link, useParams } from 'react-router-dom'
import { useActivities, useZone } from '../api/hooks'
import type { Category } from '../api/types'
import { CATEGORY_META } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { ZoneImage } from '../components/ZoneImage'
import { fmtDayShort } from '../lib/schedule'
import { useCanEdit, useTripShows } from '../lib/session'
import { useTripId } from '../lib/trip'

export default function CategoryList() {
  const { zoneId = '', category = '' } = useParams()
  const canEdit = useCanEdit()
  const shows = useTripShows()
  const tripId = useTripId()
  const cat = category as Category
  const zone = useZone(zoneId)
  const { data, isPending, isError, refetch } = useActivities(tripId)
  const meta = CATEGORY_META[cat] ?? { label: category, icon: '📍' }

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load activities." onRetry={() => refetch()} />

  // Everything of this tag in this city — **dated and undated alike**. Explore
  // used to be the undated half only, which split one tag across two screens:
  // the ramen place you had pencilled in for Thursday was in the Schedule and
  // the one you had not was here, and neither list could answer "where are we
  // eating in Kyoto?". A date decides which *day* an activity sits on, not
  // whether it is worth listing under its tag.
  //
  // `data.activities` arrives scheduled-first in day order, then saved, so the
  // filter alone puts the planned ones at the top in the order they happen.
  // An untagged activity falls under "More", which is `other`'s own row.
  const listed = data.activities.filter(
    (a) => a.zone_id === zoneId && (a.category ?? 'other') === cat
  )

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
            to={`/trips/${tripId}/zones/${zoneId}/activities/new?category=${cat}`}
            className="text-sm font-bold text-brand"
          >
            + Add
          </Link>
        )}
      </div>

      {listed.length === 0 ? (
        <EmptyState
          message={
            // The API sends a restricted caller no stays at all, so an empty
            // list here would read as "nothing booked" rather than "not shared".
            cat === 'hotel' && !shows.stays
              ? 'The travellers keep the stays private.'
              : canEdit
                ? `Nothing under ${meta.label.toLowerCase()} here yet — add the first one.`
                : `Nothing under ${meta.label.toLowerCase()} here yet.`
          }
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {listed.map((p) => (
            <li key={p.id}>
              <Link
                to={`/trips/${tripId}/activities/${p.id}`}
                className="card flex items-stretch gap-3 overflow-hidden active:scale-[0.99]"
              >
                <ZoneImage
                  src={p.image_url}
                  alt={p.name}
                  icon={meta.icon}
                  className="h-24 w-24 shrink-0"
                />
                <div className="min-w-0 flex-1 py-3 pr-3">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate font-bold">{p.name}</p>
                    {/* Which day it is on, when it is on one. Without this the
                        two halves of the list are indistinguishable, and
                        scheduling something a second time is the easy mistake. */}
                    {p.day && (
                      <span className="shrink-0 rounded-full bg-sand px-1.5 py-0.5 text-[10px] font-bold text-muted">
                        {fmtDayShort(p.day)}
                      </span>
                    )}
                  </div>
                  {p.summary_line && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted">{p.summary_line}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
