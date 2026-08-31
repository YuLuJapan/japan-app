import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useItinerary, useTrip, useZone } from '../api/hooks'
import { CATEGORIES, CATEGORY_META } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { FileList } from '../components/FileList'
import { FileUploader } from '../components/FileUploader'
import { Loading } from '../components/Loading'
import { PhotoHero } from '../components/PhotoHero'
import { Schedule } from '../components/Schedule'
import { TipEditor } from '../components/TipEditor'
import { ZonePhotoEditor } from '../components/ZonePhotoEditor'
import { cityPlan, hiddenCategories, plannedCounts } from '../lib/explore'
import { enumerateDays, toISODate, zoneDays } from '../lib/schedule'
import { useCanEdit, useTripShows } from '../lib/session'
import { useTripId } from '../lib/trip'

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })

export default function Zone() {
  const { zoneId = '' } = useParams()
  const canEdit = useCanEdit()
  const shows = useTripShows()
  const [editingPhoto, setEditingPhoto] = useState(false)
  const tripId = useTripId()
  const { data, isPending, isError, refetch } = useZone(zoneId)
  const trip = useTrip(tripId)
  const itinerary = useItinerary(tripId)

  const steps = useMemo(() => trip.data?.steps ?? [], [trip.data])
  const days = useMemo(
    () =>
      trip.data?.trip
        ? zoneDays(steps, zoneId, enumerateDays(trip.data.trip.start_date, trip.data.trip.end_date))
        : [],
    [trip.data, steps, zoneId]
  )

  // What is planned here, per category — the other half of what Explore is
  // asked. Undefined until the plan lands, so the grid paints its saved counts
  // straight away and gains the planned half when it arrives, rather than
  // holding the page or flashing a number that then changes.
  const planned = useMemo(
    () =>
      itinerary.data
        ? plannedCounts(
            cityPlan(steps, itinerary.data.items, days, zoneId, hiddenCategories(shows))
          )
        : null,
    [itinerary.data, steps, days, zoneId, shows]
  )

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load this zone." onRetry={() => refetch()} />

  const { zone, tips, files, place_counts } = data

  // Hide empty categories without breaking navigation (FR-012) — but a category
  // with nothing saved and something planned is not empty: it is exactly the
  // case this feature exists for ("Whatever the konbini has").
  const visible = CATEGORIES.filter((c) => place_counts[c] > 0 || (planned?.[c] ?? 0) > 0)

  // "Sep 19 – Sep 25 · 6 nights", from the stops that land in this city. A city
  // visited twice (out and back) has two stops, so the range spans the whole
  // visit and the nights are the sum rather than the gap between the ends —
  // otherwise a return leg would claim every night in between.
  const here = steps.filter((s) => s.zone?.id === zoneId)
  const nights = here.reduce(
    (total, s) =>
      total +
      Math.round(
        (+new Date(`${s.end_date}T00:00:00`) - +new Date(`${s.start_date}T00:00:00`)) / 86_400_000
      ),
    0
  )
  const eyebrow = here.length
    ? `${fmt(here[0].start_date)} – ${fmt(here[here.length - 1].end_date)} · ${nights} ${
        nights === 1 ? 'night' : 'nights'
      }`
    : null

  return (
    <div className="space-y-7">
      <PhotoHero
        src={zone.image_url}
        alt={zone.name}
        // The same height as the trip's hero: the two screens sit one tap
        // apart, and a banner that changed size on the way in read as the page
        // shifting under you rather than as a deliberate second scale.
        height="h-[min(62vh,30rem)]"
        backTo={`/trips/${tripId}`}
        backLabel="Back to the journey"
        eyebrow={
          eyebrow && (
            <>
              <span aria-hidden>📍</span> {eyebrow}
            </>
          )
        }
        title={zone.name}
        action={
          canEdit && !editingPhoto ? (
            <button
              type="button"
              aria-label="Change photo"
              onClick={() => setEditingPhoto(true)}
              className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-ink shadow-card backdrop-blur active:scale-95"
            >
              Photo
            </button>
          ) : null
        }
      />

      {editingPhoto && (
        <ZonePhotoEditor
          zoneId={zone.id}
          zoneName={zone.name}
          imageUrl={zone.image_url}
          onClose={() => setEditingPhoto(false)}
        />
      )}
      {zone.summary && <p className="text-[13px] leading-relaxed text-muted">{zone.summary}</p>}

      {days.length > 0 && itinerary.data && (
        <section>
          <h2 className="mb-2.5 font-display text-lg font-bold tracking-tight">Schedule</h2>
          <Schedule
            mode="zone"
            zoneId={zoneId}
            steps={steps}
            items={itinerary.data.items}
            days={days}
            today={toISODate(new Date())}
            tripId={tripId}
          />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">Explore</h2>
          {canEdit && (
            <Link
              to={`/trips/${tripId}/zones/${zoneId}/places/new`}
              className="text-xs font-bold text-brand"
            >
              + Add place
            </Link>
          )}
        </div>
        {visible.length === 0 ? (
          <EmptyState
            message={
              canEdit ? 'Nothing saved here yet — add the first place.' : 'Nothing saved here yet.'
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {visible.map((c) => {
              const meta = CATEGORY_META[c]
              const here = planned?.[c] ?? 0
              return (
                <Link
                  key={c}
                  to={`/trips/${tripId}/zones/${zoneId}/c/${c}`}
                  data-testid={`category-${c}`}
                  className="flex items-center gap-2.5 rounded-2xl bg-white p-3 shadow-card active:scale-[0.98]"
                >
                  <span
                    className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl text-sm ${meta.color}`}
                  >
                    {meta.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold leading-tight text-ink">
                      {meta.label}
                    </span>
                    {/* The planned half is silent when there is none, so a trip
                        with no plan yet reads exactly as it did before. */}
                    <span className="text-[10px] text-faint">
                      {place_counts[c]} saved
                      {here > 0 && ` · ${here} planned`}
                    </span>
                  </span>
                  <span aria-hidden className="text-sm text-hush">
                    ›
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <TipEditor tips={tips} parent={{ zone_id: zoneId }} title="Local tips" />

      {canEdit && (
        <section>
          <h2 className="mb-3 font-display text-lg font-bold tracking-tight">Files</h2>
          {files.length > 0 && (
            <div className="mb-3">
              <FileList files={files} deletable={{ kind: 'zone', id: zoneId }} />
            </div>
          )}
          <FileUploader parent={{ kind: 'zone', id: zoneId }} label="Attach a file" />
        </section>
      )}
    </div>
  )
}
