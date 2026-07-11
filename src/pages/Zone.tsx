import { Link, useParams } from 'react-router-dom'
import { useItinerary, useTrip, useZone, useZoneMapPlaces } from '../api/hooks'
import { CATEGORIES, CATEGORY_META } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { FileList } from '../components/FileList'
import { FileUploader } from '../components/FileUploader'
import { Loading } from '../components/Loading'
import { Schedule } from '../components/Schedule'
import { TipEditor } from '../components/TipEditor'
import { ZoneImage } from '../components/ZoneImage'
import { ZoneMap } from '../components/ZoneMap'
import { enumerateDays, toISODate, zoneDays } from '../lib/schedule'

export default function Zone() {
  const { zoneId = '' } = useParams()
  const { data, isPending, isError, refetch } = useZone(zoneId)
  const trip = useTrip()
  const itinerary = useItinerary()
  const mapPlaces = useZoneMapPlaces(zoneId)

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load this zone." onRetry={() => refetch()} />

  const { zone, tips, files, place_counts } = data
  const hasCoords = typeof zone.lat === 'number' && typeof zone.lng === 'number'

  const steps = trip.data?.steps ?? []
  const days = trip.data?.trip
    ? zoneDays(steps, zoneId, enumerateDays(trip.data.trip.start_date, trip.data.trip.end_date))
    : []
  // hide empty categories without breaking navigation (FR-012)
  const visible = CATEGORIES.filter((c) => place_counts[c] > 0)

  return (
    <div className="space-y-8">
      <div>
        <Link to="/" className="text-sm font-semibold text-muted">
          ‹ Journey
        </Link>
        <div className="relative mt-3 overflow-hidden rounded-3xl shadow-card">
          <ZoneImage src={zone.image_url} alt={zone.name} className="h-52 w-full" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-5 pb-4 pt-10">
            <h1 className="font-display text-3xl font-extrabold text-white drop-shadow">{zone.name}</h1>
          </div>
        </div>
        {zone.summary && <p className="mt-3 text-sm leading-relaxed text-muted">{zone.summary}</p>}
      </div>

      {hasCoords && (
        <section>
          <h2 className="mb-3 font-display text-lg font-extrabold">Map</h2>
          <ZoneMap
            zoneId={zoneId}
            zoneName={zone.name}
            center={[zone.lat as number, zone.lng as number]}
            places={mapPlaces.data?.places ?? []}
          />
        </section>
      )}

      {days.length > 0 && itinerary.data && (
        <section>
          <h2 className="mb-3 font-display text-lg font-extrabold">Schedule</h2>
          <Schedule
            mode="zone"
            zoneId={zoneId}
            steps={steps}
            items={itinerary.data.items}
            days={days}
            today={toISODate(new Date())}
          />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold">Explore</h2>
          <Link to={`/zones/${zoneId}/places/new`} className="text-sm font-bold text-brand">
            + Add place
          </Link>
        </div>
        {visible.length === 0 ? (
          <EmptyState message="Nothing saved here yet — add the first place." />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visible.map((c) => {
              const meta = CATEGORY_META[c]
              return (
                <Link
                  key={c}
                  to={`/zones/${zoneId}/c/${c}`}
                  data-testid={`category-${c}`}
                  className="card flex items-center gap-3 p-4 active:scale-[0.98]"
                >
                  <span className={`chip h-10 w-10 justify-center rounded-2xl text-lg ${meta.color}`}>
                    {meta.icon}
                  </span>
                  <span>
                    <span className="block text-sm font-bold leading-tight">{meta.label}</span>
                    <span className="text-xs text-muted">{place_counts[c]} saved</span>
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <TipEditor tips={tips} parent={{ zone_id: zoneId }} title="Local tips" />

      <section>
        <h2 className="mb-3 font-display text-lg font-extrabold">Files</h2>
        {files.length > 0 && (
          <div className="mb-3">
            <FileList files={files} deletable={{ kind: 'zone', id: zoneId }} />
          </div>
        )}
        <FileUploader parent={{ kind: 'zone', id: zoneId }} label="Attach a file" />
      </section>
    </div>
  )
}
