import { Link, useParams } from 'react-router-dom'
import { useZone } from '../api/hooks'
import { CATEGORIES, CATEGORY_LABELS } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { FileList } from '../components/FileList'
import { Loading } from '../components/Loading'
import { TipEditor } from '../components/TipEditor'
import { ZoneImage } from '../components/ZoneImage'

export default function Zone() {
  const { zoneId = '' } = useParams()
  const { data, isPending, isError, refetch } = useZone(zoneId)

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load this zone." onRetry={() => refetch()} />

  const { zone, tips, files, place_counts } = data
  // hide empty categories without breaking navigation (FR-012)
  const visible = CATEGORIES.filter((c) => place_counts[c] > 0)

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="text-xs text-fog">
          ← Journey
        </Link>
        <div className="mt-2 overflow-hidden rounded-xl border border-sand">
          <ZoneImage src={zone.image_url} alt={`${zone.name} photo`} nameJa={zone.name_ja} className="h-40 w-full" />
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold">
          {zone.name}
          {zone.name_ja && <span className="ml-3 text-xl font-normal text-fog">{zone.name_ja}</span>}
        </h1>
        {zone.summary && <p className="mt-2 text-sm leading-relaxed text-fog">{zone.summary}</p>}
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-fog">Explore 探す</h2>
          <Link to={`/zones/${zoneId}/places/new`} className="text-sm font-medium text-shu">
            + Add place
          </Link>
        </div>
        {visible.length === 0 ? (
          <p className="mt-2 text-sm text-fog">
            Nothing saved here yet — add the first place.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {visible.map((c) => (
              <Link
                key={c}
                to={`/zones/${zoneId}/c/${c}`}
                data-testid={`category-${c}`}
                className="rounded-lg border border-sand bg-white/50 px-4 py-3 active:bg-white/80"
              >
                <p className="font-medium">{CATEGORY_LABELS[c].en}</p>
                <p className="mt-0.5 text-xs text-fog">
                  {CATEGORY_LABELS[c].ja} · {place_counts[c]}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <TipEditor tips={tips} parent={{ zone_id: zoneId }} title="Zone tips 心得" />

      {files.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-fog">Files 書類</h2>
          <div className="mt-2">
            <FileList files={files} />
          </div>
        </section>
      )}
    </div>
  )
}
