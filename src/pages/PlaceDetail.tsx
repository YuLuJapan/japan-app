import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { usePlace } from '../api/hooks'
import { useDeletePlace } from '../api/mutations'
import { CATEGORY_META } from '../api/types'
import { AddPlaceToDay } from '../components/AddPlaceToDay'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState } from '../components/ErrorState'
import { FileList } from '../components/FileList'
import { Loading } from '../components/Loading'
import { TipEditor } from '../components/TipEditor'
import { ZoneImage } from '../components/ZoneImage'
import { placeMapsUrl } from '../lib/maps'

export default function PlaceDetail() {
  const { placeId = '' } = useParams()
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = usePlace(placeId)
  const [confirming, setConfirming] = useState(false)
  const deletePlace = useDeletePlace(data?.place.zone_id)

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load this place." onRetry={() => refetch()} />

  const { place, tips, files } = data
  const meta = CATEGORY_META[place.category]

  return (
    <div className="space-y-8">
      <div>
        <Link to={`/zones/${place.zone_id}/c/${place.category}`} className="text-sm font-semibold text-muted">
          ‹ {meta.label}
        </Link>
        {place.image_url && (
          <div className="mt-3 overflow-hidden rounded-3xl shadow-card">
            <ZoneImage src={place.image_url} alt={place.name} icon={meta.icon} className="h-52 w-full" />
          </div>
        )}
        <div className="mt-3 flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl font-extrabold">{place.name}</h1>
          <span className={`chip shrink-0 ${meta.color}`}>
            {meta.icon} {meta.singular}
          </span>
        </div>
      </div>

      {place.description && <p className="text-sm leading-relaxed">{place.description}</p>}

      <div>
        {place.address && (
          <>
            <h2 className="section-title">Address</h2>
            <p className="mt-1 text-sm">{place.address}</p>
          </>
        )}
        <a
          href={placeMapsUrl(place.name, place.address)}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-primary mt-3 w-full"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          Directions
        </a>
      </div>

      <AddPlaceToDay place={place} />

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

      <TipEditor tips={tips} parent={{ place_id: placeId }} title="Tips" />

      {files.length > 0 && (
        <section>
          <h2 className="mb-3 section-title">Files</h2>
          <FileList files={files} />
        </section>
      )}

      <div className="flex gap-3 border-t border-line pt-6">
        <Link to={`/places/${placeId}/edit`} className="btn-ghost flex-1">
          Edit
        </Link>
        <button type="button" className="btn-danger flex-1" onClick={() => setConfirming(true)}>
          Delete
        </button>
      </div>
      {deletePlace.isError && (
        <ErrorState message="Delete failed — try again." onRetry={() => deletePlace.mutate(placeId)} />
      )}

      <ConfirmDialog
        open={confirming}
        title={`Delete "${place.name}"?`}
        message="Its tips are removed too. Attached files are kept in trip documents."
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirming(false)
          deletePlace.mutate(placeId, {
            onSuccess: () => navigate(`/zones/${place.zone_id}/c/${place.category}`, { replace: true }),
          })
        }}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
