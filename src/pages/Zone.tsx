import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useActivities, useTrip, useZone } from '../api/hooks'
import { CATEGORIES, CATEGORY_META, type Category } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { FileList } from '../components/FileList'
import { FileUploader } from '../components/FileUploader'
import { Loading } from '../components/Loading'
import { PhotoHero } from '../components/PhotoHero'
import { Schedule } from '../components/Schedule'
import { TipEditor } from '../components/TipEditor'
import { ZonePhotoEditor } from '../components/ZonePhotoEditor'
import { enumerateDays, fmtDayShort, toISODate, zoneDays } from '../lib/schedule'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'

/**
 * What one tag holds in this city, split the way the traveller reads it.
 *
 * Counted from the same list `CategoryList` filters rather than from a server
 * tally, so a count can never name rows the list does not show. That is not
 * only tidiness: a member whose view hides stays is sent a scheduled stay with
 * its category stripped (FR-021), so it lands under “More” here — exactly
 * where the list puts it — while a server count would still have filed it
 * under Stays and then zeroed it, leaving “More” one short of its own list.
 */
function tallyByCategory(
  activities: { zone_id: string | null; category: Category | null; day: string | null }[],
  zoneId: string
) {
  const empty = () => ({ total: 0, planned: 0 })
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, empty()])) as Record<
    Category,
    { total: number; planned: number }
  >
  for (const a of activities) {
    if (a.zone_id !== zoneId) continue
    const t = out[a.category ?? 'other']
    t.total++
    if (a.day !== null) t.planned++
  }
  return out
}

/**
 * “3 planned · 9 saved”. Both halves are named only when both exist — a tag
 * holding nothing but ideas should not read as though something were missing.
 */
const tallyLabel = ({ total, planned }: { total: number; planned: number }) => {
  if (total === 0) return 'Nothing yet'
  const saved = total - planned
  if (planned === 0) return `${saved} saved`
  if (saved === 0) return `${planned} planned`
  return `${planned} planned · ${saved} saved`
}

export default function Zone() {
  const { zoneId = '' } = useParams()
  const canEdit = useCanEdit()
  const [editingPhoto, setEditingPhoto] = useState(false)
  const tripId = useTripId()
  const { data, isPending, isError, refetch } = useZone(zoneId)
  const trip = useTrip(tripId)
  const activities = useActivities(tripId)

  if (isPending) return <Loading />
  if (isError) return <ErrorState message="Could not load this zone." onRetry={() => refetch()} />

  const { zone, tips, files } = data

  const steps = trip.data?.steps ?? []
  const days = trip.data?.trip
    ? zoneDays(steps, zoneId, enumerateDays(trip.data.trip.start_date, trip.data.trip.end_date))
    : []
  const tallies = tallyByCategory(activities.data?.activities ?? [], zoneId)
  // Every tag shows for anyone who can add, empty ones included: an empty tag
  // is precisely where a new activity goes, so hiding it hides the way in. A
  // read-only member still sees only what exists — for them an empty row is a
  // button that leads nowhere.
  const visible = canEdit ? CATEGORIES : CATEGORIES.filter((c) => tallies[c].total > 0)

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
    ? `${fmtDayShort(here[0].start_date)} – ${fmtDayShort(here[here.length - 1].end_date)} · ${nights} ${
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

      {days.length > 0 && activities.data && (
        <section>
          <h2 className="mb-2.5 font-display text-lg font-bold tracking-tight">Schedule</h2>
          <Schedule
            mode="zone"
            zoneId={zoneId}
            steps={steps}
            items={activities.data.activities.filter((a) => a.day !== null)}
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
              to={`/trips/${tripId}/zones/${zoneId}/activities/new`}
              className="text-xs font-bold text-brand"
            >
              + Add
            </Link>
          )}
        </div>
        {/* The tallies come from the activities list, so until it lands there is
            nothing truthful to say: rendering the grid early would claim every
            tag was empty, and for a read-only member would claim the whole city
            was. The heading and Add stay put so the section does not jump. */}
        {!activities.data ? null : visible.length === 0 ? (
          <EmptyState
            message={
              canEdit ? 'Nothing saved here yet — add the first place.' : 'Nothing saved here yet.'
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {visible.map((c) => {
              const meta = CATEGORY_META[c]
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
                    <span className="text-[10px] text-faint">{tallyLabel(tallies[c])}</span>
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
