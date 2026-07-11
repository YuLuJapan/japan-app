import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { usePlace } from '../api/hooks'
import { useDeletePlace } from '../api/mutations'
import { CATEGORY_LABELS } from '../api/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState } from '../components/ErrorState'
import { FileList } from '../components/FileList'
import { Loading } from '../components/Loading'
import { TipEditor } from '../components/TipEditor'
import { ZoneImage } from '../components/ZoneImage'

export default function PlaceDetail() {
  const { placeId = '' } = useParams()
  const navigate = useNavigate()
  const { data, isPending, isError, refetch } = usePlace(placeId)
  const [confirming, setConfirming] = useState(false)
  const deletePlace = useDeletePlace(data?.place.zone_id)

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load this place." onRetry={() => refetch()} />

  const { place, tips, files } = data
  const label = CATEGORY_LABELS[place.category]

  return (
    <div className="space-y-8">
      <div>
        <Link to={`/zones/${place.zone_id}/c/${place.category}`} className="text-xs text-fog">
          ← {label.en}
        </Link>
        {place.image_url && (
          <div className="mt-2 overflow-hidden rounded-xl border border-sand">
            <ZoneImage
              src={place.image_url}
              alt={`${place.name} photo`}
              nameJa={place.name_ja}
              className="h-44 w-full"
            />
          </div>
        )}
        <h1 className="mt-3 font-display text-2xl font-bold">{place.name}</h1>
        {place.name_ja && <p className="text-fog">{place.name_ja}</p>}
        <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-shu">
          {label.en} {label.ja}
        </p>
      </div>

      {place.description && <p className="text-sm leading-relaxed">{place.description}</p>}

      {place.address && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-fog">Address 住所</h2>
          <p className="mt-1 text-sm">{place.address}</p>
        </div>
      )}

      {place.links.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-fog">Links リンク</h2>
          <ul className="mt-1 space-y-1">
            {place.links.map((link, i) => (
              <li key={i}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm text-shu underline underline-offset-2"
                >
                  {link.label} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <TipEditor tips={tips} parent={{ place_id: placeId }} />

      {files.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-fog">Files 書類</h2>
          <div className="mt-2">
            <FileList files={files} />
          </div>
        </section>
      )}

      <div className="rule" />
      <div className="flex gap-2">
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
