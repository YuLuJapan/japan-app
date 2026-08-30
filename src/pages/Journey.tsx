import { Link } from 'react-router-dom'
import { useItinerary, useTrip, useTripExportPrefetch } from '../api/hooks'
import { CountdownWidget } from '../components/CountdownWidget'
import { ErrorState } from '../components/ErrorState'
import { GenericCountdown } from '../components/GenericCountdown'
import { InstallBanner } from '../components/InstallPrompt'
import { JourneyStepsSlider } from '../components/JourneyStepsSlider'
import { Loading } from '../components/Loading'
import { PhotoHero } from '../components/PhotoHero'
import { Schedule } from '../components/Schedule'
import { SushiSequence } from '../components/SushiSequence'
import { useBooleanFlag } from '../lib/flags'
import { enumerateDays, toISODate } from '../lib/schedule'
import { useCanEdit, useTripShows } from '../lib/session'
import { useTripId } from '../lib/trip'

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })

// Only the Japan trip ever had hero artwork. Kept as the gate on the sushi
// sequence below, which was drawn for this one destination and is nonsense
// anywhere else. Matches by word so "Japan Solo" etc. still count.
const isJapanTrip = (name: string) => /\bjapan\b/i.test(name)

export default function Journey() {
  const canEdit = useCanEdit()
  const shows = useTripShows()
  const tripId = useTripId()
  const { data, isPending, isError, refetch } = useTrip(tripId)
  const itinerary = useItinerary(tripId)
  const canExport = useBooleanFlag('export-trip', false)
  /**
   * Chat, while it is rolling out. Default off, so with no PostHog answer —
   * local dev, a deploy without analytics, a phone with no signal — there is no
   * button, which is the right state for a feature that costs money per use.
   *
   * A floating button rather than a seventh nav tab, deliberately: six tabs
   * already force three labels to shorten (`lib/nav-labels.ts`), and a seventh
   * would need a label tier existing only when two flags are both on — a second
   * thing to undo, which is what turning a flag off is supposed to avoid.
   */
  const canChat = useBooleanFlag('chat-bot', false) && canEdit
  /**
   * The scroll-driven sushi hero, kept behind a flag rather than deleted.
   *
   * The redesign replaces it with a photo of where you are actually going, and
   * that is the default — so with no PostHog answer (local dev, a deploy
   * without analytics, a phone with no signal) every trip gets the photo. Turn
   * `journey-sushi-hero` on to put the animation back on Japan trips; it stays
   * gated on the destination either way, because it is a Japan artwork.
   */
  const sushiHero = useBooleanFlag('journey-sushi-hero', false)
  // Warms the export payloads so the file can still be made on a train
  // (research R4). Called before the early returns below, because a hook has
  // to be — and it costs nothing while the trip itself is still loading.
  // Follows the flag: there is no sense warming a payload for a screen nobody
  // can open, and when the flag arrives late the hook re-runs and warms it
  // then.
  useTripExportPrefetch(tripId, canExport)

  if (isPending) return <Loading label="Loading the journey…" />
  if (isError) return <ErrorState message="Could not load the trip." onRetry={() => refetch()} />

  const today = new Date()
  const hasSteps = data.steps.length > 0
  const meta = `${fmt(data.trip.start_date)} – ${fmt(data.trip.end_date)} · ${data.steps.length} ${
    data.steps.length === 1 ? 'stop' : 'stops'
  }`
  // The redesign sets the destination in 40px extrabold over the photo, so the
  // hero takes the short label rather than the composed title: "Japan", not
  // "Yuval and Luciana in Japan", which would wrap to three lines and lose the
  // photo underneath it. The full title is still what the trips list and the
  // export call this trip.
  const heroTitle = data.trip.name || data.trip.country || data.trip.display_title
  // Nothing on the trip carries a photo of its own, so the hero borrows the
  // first stop's — the city you land in, which is the picture of the trip
  // anyone would have chosen. With no stops (or no photo on the first one)
  // ZoneImage falls back to the warm gradient rather than a broken image.
  const heroImage = data.steps[0]?.zone?.image_url

  const countdown = data.flight ? (
    <CountdownWidget flight={data.flight} />
  ) : (
    <GenericCountdown
      startDate={data.trip.start_date}
      startTime={data.trip.start_time}
      startTz={data.trip.start_tz}
      // Two different absences look identical here: no booking attached
      // yet, or one this caller may not see. `shows` is what tells them
      // apart, so the second doesn't read as the first.
      note={shows.flight ? undefined : 'The travellers keep the flight details private.'}
    />
  )

  return (
    <div className="space-y-6">
      {/* Above the hero on purpose: below it, on a phone, it sat under the
          fold behind a full-bleed image and a countdown. */}
      <InstallBanner />

      {sushiHero && isJapanTrip(data.trip.country ?? data.trip.name ?? '') ? (
        <>
          <SushiSequence
            title={data.trip.display_title}
            destination={data.trip.country ?? undefined}
            meta={meta}
          />
          {countdown}
        </>
      ) : (
        <PhotoHero
          src={heroImage}
          alt={heroTitle}
          // The design draws a 480px hero on a 300px-wide phone frame — a tall,
          // deliberately photo-led opening. Taken literally that is 1.6× the
          // viewport width, which on a real handset buries the countdown card
          // well below the fold, so it is capped: 62vh keeps the card peeking
          // on every screen height, and 30rem is the design's own 480px as the
          // ceiling on a tablet.
          height="h-[min(62vh,30rem)]"
          eyebrow={
            <>
              <span aria-hidden>📍</span> Trip overview
            </>
          }
          title={heroTitle}
          meta={meta}
          // The design's own numbers: the card rides up 64px and the title
          // clears it by 12px. PhotoHero derives the second from the first.
          overlap={64}
        >
          {/* Rides up over the bottom of the photo, as the design draws it.
              `px-5` and not `px-4`: this card is the left edge every other
              block on the screen lines up against — the journey tiles, the day
              rail and both section headings all sit on <main>'s gutter, so a
              card inset 16px further than they are made them read as jammed
              against the screen edge. One gutter, one vertical line. */}
          <div className="relative z-[1] -mt-16 px-5">{countdown}</div>
        </PhotoHero>
      )}

      {hasSteps ? (
        <>
          <div>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="font-display text-2xl font-bold tracking-tight">The journey</h2>
              <div className="flex items-center gap-3">
                {/* Everyone on the trip can export it, viewers included: the
                    file is a subset of what they are already looking at. */}
                {canExport && (
                  <Link to={`/trips/${tripId}/export`} className="text-xs font-bold text-brand">
                    Export
                  </Link>
                )}
                {canEdit ? (
                  <Link
                    to={`/trips/${tripId}/journey/edit`}
                    className="text-xs font-bold text-brand"
                  >
                    Edit
                  </Link>
                ) : (
                  <span className="text-[11px] text-faint">swipe →</span>
                )}
              </div>
            </div>
            <JourneyStepsSlider steps={data.steps} today={today} tripId={tripId} />
          </div>

          <section>
            <h2 className="mb-3 font-display text-2xl font-bold tracking-tight">Day by day</h2>
            {itinerary.isPending ? (
              <Loading label="Loading the schedule…" />
            ) : itinerary.isError ? (
              <ErrorState
                message="Could not load the schedule."
                onRetry={() => itinerary.refetch()}
              />
            ) : (
              <Schedule
                mode="trip"
                steps={data.steps}
                items={itinerary.data.items}
                days={enumerateDays(data.trip.start_date, data.trip.end_date)}
                today={toISODate(today)}
                tripId={tripId}
              />
            )}
          </section>
        </>
      ) : (
        <div className="rounded-3xl border border-dashed border-line px-5 py-6 text-center">
          <p className="font-display text-base font-semibold">No stops yet</p>
          <p className="mt-1.5 text-sm text-muted">
            Add the cities you&apos;ll sleep in and the day-by-day plan builds itself.
          </p>
          {canEdit && (
            <Link
              to={`/trips/${tripId}/journey/edit`}
              className="btn-primary mt-4 inline-flex px-5"
            >
              + Add a stop
            </Link>
          )}
        </div>
      )}

      {/* Floating, because chat is a thing you reach for from anywhere on this
          screen rather than a section of it. Sits above the tab bar, which is
          fixed, and clear of the right edge. */}
      {canChat && (
        <Link
          to={`/trips/${tripId}/chat`}
          className="fixed bottom-24 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-ink px-4.5 py-3 text-sm font-bold text-canvas shadow-pop"
          aria-label="Ask about this trip"
        >
          <span aria-hidden>✦</span> Ask
        </Link>
      )}
    </div>
  )
}
