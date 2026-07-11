import { Link, useParams } from 'react-router-dom'
import { useZone, useZonePlaces } from '../api/hooks'
import type { Category } from '../api/types'
import { CATEGORY_LABELS } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { ZoneImage } from '../components/ZoneImage'

export default function CategoryList() {
  const { zoneId = '', category = '' } = useParams()
  const cat = category as Category
  const zone = useZone(zoneId)
  const { data, isPending, isError, refetch } = useZonePlaces(zoneId, cat)

  const label = CATEGORY_LABELS[cat] ?? { en: category, ja: '' }

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load places." onRetry={() => refetch()} />

  return (
    <div>
      <Link to={`/zones/${zoneId}`} className="text-xs text-fog">
        ← {zone.data?.zone.name ?? 'Zone'}
      </Link>
      <div className="mt-2 flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-bold">
          {label.en} <span className="ml-1 text-base font-normal text-fog">{label.ja}</span>
        </h1>
        <Link to={`/zones/${zoneId}/places/new?category=${cat}`} className="text-sm font-medium text-shu">
          + Add
        </Link>
      </div>

      {data.places.length === 0 ? (
        <EmptyState message={`Nothing saved under ${label.en.toLowerCase()} here yet.`} />
      ) : (
        <ul className="mt-4 space-y-2">
          {data.places.map((p) => (
            <li key={p.id}>
              <Link
                to={`/places/${p.id}`}
                className="flex items-stretch gap-3 overflow-hidden rounded-xl border border-sand bg-white/50 active:bg-white/80"
              >
                <ZoneImage
                  src={p.image_url}
                  alt={`${p.name} photo`}
                  nameJa={p.name_ja}
                  className="h-20 w-20 shrink-0"
                />
                <div className="min-w-0 flex-1 py-2.5 pr-3">
                  <p className="truncate font-medium">
                    {p.name}
                    {p.name_ja && <span className="ml-2 text-sm font-normal text-fog">{p.name_ja}</span>}
                  </p>
                  {p.summary_line && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-fog">{p.summary_line}</p>
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
