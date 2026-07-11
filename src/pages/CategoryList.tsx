import { Link, useParams } from 'react-router-dom'
import { useZone, useZonePlaces } from '../api/hooks'
import type { Category } from '../api/types'
import { CATEGORY_META } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { ZoneImage } from '../components/ZoneImage'

export default function CategoryList() {
  const { zoneId = '', category = '' } = useParams()
  const cat = category as Category
  const zone = useZone(zoneId)
  const { data, isPending, isError, refetch } = useZonePlaces(zoneId, cat)
  const meta = CATEGORY_META[cat] ?? { label: category, icon: '📍' }

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load places." onRetry={() => refetch()} />

  return (
    <div>
      <Link to={`/zones/${zoneId}`} className="text-sm font-semibold text-muted">
        ‹ {zone.data?.zone.name ?? 'Zone'}
      </Link>
      <div className="m-0 mt-2 flex items-center justify-between">
        <h1 className="font-display text-2xl font-extrabold">
          <span className="mr-2">{meta.icon}</span>
          {meta.label}
        </h1>
        <Link to={`/zones/${zoneId}/places/new?category=${cat}`} className="text-sm font-bold text-brand">
          + Add
        </Link>
      </div>

      {data.places.length === 0 ? (
        <EmptyState message={`Nothing saved under ${meta.label.toLowerCase()} here yet.`} />
      ) : (
        <ul className="mt-4 space-y-3">
          {data.places.map((p) => (
            <li key={p.id}>
              <Link
                to={`/places/${p.id}`}
                className="card flex items-stretch gap-3 overflow-hidden active:scale-[0.99]"
              >
                <ZoneImage src={p.image_url} alt={p.name} icon={meta.icon} className="h-24 w-24 shrink-0" />
                <div className="min-w-0 flex-1 py-3 pr-3">
                  <p className="truncate font-bold">{p.name}</p>
                  {p.summary_line && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{p.summary_line}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
