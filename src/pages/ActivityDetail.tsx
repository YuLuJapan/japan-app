import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useActivity, useTrip } from '../api/hooks'
import { useDeleteActivity } from '../api/mutations'
import { CATEGORY_META } from '../api/types'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { ScheduleActivity } from '../components/ScheduleActivity'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState } from '../components/ErrorState'
import { FileList } from '../components/FileList'
import { FileUploader } from '../components/FileUploader'
import { Loading } from '../components/Loading'
import { TipEditor } from '../components/TipEditor'
import { ZoneImage } from '../components/ZoneImage'
import { placeMapsUrl } from '../lib/maps'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'

export default function ActivityDetail() {
  const { activityId = '' } = useParams()
  const canEdit = useCanEdit()
  const tripId = useTripId()
  const navigate = useNavigate()
  const { data, error, isPending, isError, refetch } = useActivity(activityId)
  const trip = useTrip(tripId)
  const [confirming, setConfirming] = useState(false)
  const deleteActivity = useDeleteActivity(data?.activity.zone_id, data?.activity.category)

  if (isPending) return <Loading />
  // A stay is refused outright for a guest code (the booking lives in it), so
  // say that rather than offering a retry that will fail the same way.
  if (isError) {
    return error instanceof ApiError && error.code === 'FORBIDDEN' ? (
      <ErrorState message="The travellers keep the stays private." />
    ) : (
      <ErrorState message="Could not load this activity." onRetry={() => refetch()} />
    )
  }

  const { activity: place, tips, files } = data
  // An untagged activity reads as "More" — the same neutral the grid uses.
  const meta = CATEGORY_META[place.category ?? 'other']
  // The city, so the map search lands in the right country (trips are worldwide).
  const city = trip.data?.steps?.find((s) => s.zone?.id === place.zone_id)?.zone?.name ?? null
  // What makes a maps link worth offering: a typed address, or the
  // coordinates a picked suggestion (or the backfill) stored. Either one names
  // the doorway; the name alone does not.
  const hasLocation =
    Boolean(place.address?.trim()) ||
    (typeof place.lat === 'number' && typeof place.lng === 'number')

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumbs
          trail={[
            { label: 'Journey', to: `/trips/${tripId}` },
            ...(city ? [{ label: city, to: `/trips/${tripId}/zones/${place.zone_id}` }] : []),
            // A scheduled activity has left Explore, so its category list is
            // not where it came from — the city is as far up as the trail goes.
            ...(place.day === null && place.zone_id
              ? [
                  {
                    label: meta.label,
                    to: `/trips/${tripId}/zones/${place.zone_id}/c/${place.category ?? 'other'}`,
                  },
                ]
              : []),
          ]}
        />
        {place.image_url && (
          <div className="mt-3 overflow-hidden rounded-3xl shadow-card">
            <ZoneImage
              src={place.image_url}
              alt={place.name}
              icon={meta.icon}
              className="h-52 w-full"
            />
          </div>
        )}
        <div className="mt-3 flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-bold">{place.name}</h1>
          <span className={`chip shrink-0 ${meta.color}`}>
            {meta.icon} {meta.singular}
          </span>
        </div>
      </div>

      {place.description && <p className="text-sm leading-relaxed">{place.description}</p>}

      {/* Directions are only honest once the activity says where it is. With
          neither an address nor coordinates the link is a maps search for a
          bare name, which finds a namesake as readily as the place — so a
          writer is offered the way to fix that instead, and a reader, who
          cannot, is shown nothing rather than a button that guesses. */}
      {(hasLocation || canEdit) && (
        <div>
          {place.address && (
            <>
              <h2 className="section-title">Address</h2>
              <p className="mt-1 text-sm">{place.address}</p>
            </>
          )}
          {hasLocation ? (
            <a
              href={placeMapsUrl(place.name, place.address, city)}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-primary mt-3 w-full"
            >
              <PinIcon />
              Directions
            </a>
          ) : (
            <Link
              to={`/trips/${tripId}/activities/${activityId}/edit`}
              className="btn-ghost mt-3 w-full"
            >
              <PinIcon />
              Add a location
            </Link>
          )}
        </div>
      )}

      <ScheduleActivity activity={place} />

      {place.links.length > 0 && (
        <div>
          <h2 className="section-title">Links</h2>
          <ul className="mt-2 space-y-2">
            {place.links.map((link, i) => (
              <li key={i}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center justify-between rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-brand active:scale-[0.99]"
                >
                  {link.label}
                  <span aria-hidden>↗</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <TipEditor tips={tips} parent={{ activity_id: activityId }} title="Tips" />

      {canEdit && (
        <section>
          <h2 className="mb-3 section-title">Files</h2>
          {files.length > 0 && (
            <div className="mb-3">
              <FileList files={files} deletable={{ kind: 'activity', id: activityId }} />
            </div>
          )}
          <FileUploader parent={{ kind: 'activity', id: activityId }} label="Attach a file" />
        </section>
      )}

      {canEdit && (
        <>
          <div className="flex gap-3 border-t border-line pt-6">
            <Link
              to={`/trips/${tripId}/activities/${activityId}/edit`}
              className="btn-ghost flex-1"
            >
              Edit
            </Link>
            <button type="button" className="btn-danger flex-1" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </div>
          {deleteActivity.isError && (
            <ErrorState
              message="Delete failed — try again."
              onRetry={() => deleteActivity.mutate(activityId)}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Delete "${place.name}"?`}
        message="Its tips are removed too. Attached files are kept in trip documents."
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirming(false)
          deleteActivity.mutate(activityId, {
            onSuccess: () =>
              navigate(`/trips/${tripId}/zones/${place.zone_id}/c/${place.category}`, {
                replace: true,
              }),
          })
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

/** The marker both states of that button carry — one shape, two labels. */
function PinIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}
