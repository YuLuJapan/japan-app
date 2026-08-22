// "Where to next?" — every trip, with an add/edit sheet. Landing page after
// the gate; each card opens that trip's five tabs at /trips/:tripId.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTrips } from '../api/hooks'
import type { Trip } from '../api/types'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { RingMark } from '../components/RingMark'
import { SignOutButton } from '../components/SignOutButton'
import { TripSheet } from '../components/TripSheet'
import { useCanEdit } from '../lib/session'

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' })

function dateRange(trip: Trip): string {
  const start = new Date(`${trip.start_date}T00:00:00`)
  const end = new Date(`${trip.end_date}T00:00:00`)
  const sameYear = start.getFullYear() === end.getFullYear()
  return sameYear
    ? `${fmt(trip.start_date)} – ${fmt(trip.end_date)}, ${end.getFullYear()}`
    : `${fmt(trip.start_date)}, ${start.getFullYear()} – ${fmt(trip.end_date)}, ${end.getFullYear()}`
}

function avatarBg(name: string): string {
  const palette = ['#F1543F', '#17150F', '#6E8248', '#4C6273', '#B07A62', '#8A5FA8']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997
  return palette[h % palette.length]
}

function swatchFor(id: string): string {
  const gradients = [
    'linear-gradient(160deg,#F1543F,#C8302A)',
    'linear-gradient(160deg,#8fa9b8,#4c6273)',
    'linear-gradient(160deg,#a9b87f,#6e8248)',
    'linear-gradient(160deg,#e0b872,#a8763b)',
    'linear-gradient(160deg,#b07ac0,#6b3f7a)',
  ]
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997
  return gradients[h % gradients.length]
}

function TripCard({ trip, onEdit }: { trip: Trip; onEdit: () => void }) {
  const canEdit = useCanEdit()
  const navigate = useNavigate()
  return (
    <div
      onClick={() => navigate(`/trips/${trip.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/trips/${trip.id}`)}
      className="card flex cursor-pointer items-center gap-3.5 p-4 active:scale-[0.99]"
    >
      <div
        className="flex h-[4.6rem] w-[4.6rem] shrink-0 items-end justify-center overflow-hidden rounded-2xl pb-1"
        style={{ background: swatchFor(trip.id) }}
        aria-hidden
      >
        <span className="font-display text-4xl font-extrabold leading-none text-white/90">
          {trip.display_title[0]?.toUpperCase()}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-extrabold tracking-tight">{trip.display_title}</p>
        <p className="mt-0.5 text-xs text-muted">{dateRange(trip)}</p>
        {trip.people.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            {trip.people.slice(0, 4).map((p, i) => (
              <span
                key={`${p.name}-${i}`}
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: avatarBg(p.name) }}
                aria-hidden
              >
                {p.name[0]?.toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="chip shrink-0 bg-canvas font-semibold text-muted active:scale-95"
        >
          Edit
        </button>
      )}
    </div>
  )
}

export default function TripsList() {
  const canEdit = useCanEdit()
  const { data, isPending, isError, refetch } = useTrips()
  const [sheet, setSheet] = useState<{ mode: 'add' | 'edit'; trip?: Trip } | null>(null)

  if (isPending) return <Loading label="Loading your trips…" />
  if (isError) return <ErrorState message="Could not load your trips." onRetry={() => refetch()} />

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = data.trips.filter((t) => t.end_date >= today)
  const past = data.trips.filter((t) => t.end_date < today)

  return (
    <div className="mx-auto flex min-h-dvh max-w-app flex-col bg-canvas">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-canvas/85 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <RingMark size={30} />
          <span className="font-display text-lg font-extrabold tracking-tight">Onward</span>
        </div>
        <SignOutButton />
      </header>

      <main className="flex-1 px-5 pb-10 pt-1">
        <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight">
          Where to
          <br />
          next?
        </h1>
        <p className="mt-2.5 max-w-[280px] text-sm text-muted">
          Add a destination to start a trip. Everything — plans, lists, papers — lives inside it.
        </p>

        <p className="section-title mt-7">Your trips</p>
        <div className="mt-3 flex flex-col gap-3.5">
          {upcoming.length === 0 && (
            <EmptyState
              message={canEdit ? 'No trips yet — add your first one.' : 'No trips yet.'}
            />
          )}
          {upcoming.map((t) => (
            <TripCard key={t.id} trip={t} onEdit={() => setSheet({ mode: 'edit', trip: t })} />
          ))}

          {canEdit && (
            <button
              type="button"
              onClick={() => setSheet({ mode: 'add' })}
              className="flex items-center gap-3 rounded-3xl border-[1.5px] border-dashed border-line p-5 text-left text-muted active:scale-[0.99]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-canvas text-xl font-semibold leading-none">
                +
              </span>
              <span className="text-sm font-semibold">Add a destination</span>
            </button>
          )}
        </div>

        {past.length > 0 && (
          <>
            <p className="section-title mt-7">Past</p>
            <div className="mt-3 flex flex-col gap-2.5">
              {past.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-3xl bg-white/60 px-4.5 py-3.5"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink/70">{t.display_title}</p>
                    <p className="mt-0.5 text-xs text-muted">{dateRange(t)}</p>
                  </div>
                  <span className="text-[11px] font-bold tracking-wide text-muted">ARCHIVED</span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      <TripSheet mode={sheet?.mode ?? null} trip={sheet?.trip} onClose={() => setSheet(null)} />
    </div>
  )
}
