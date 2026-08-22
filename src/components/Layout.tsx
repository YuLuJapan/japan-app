import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTrip } from '../api/hooks'
import { clearReminderBadge, hasUnseenReminder } from '../lib/push'
import { useCanEdit, useTripShows } from '../lib/session'
import { useTripId } from '../lib/trip'
import { RingMark } from './RingMark'
import { SignOutButton } from './SignOutButton'

type IconName = 'journey' | 'shopping' | 'reminders' | 'essentials' | 'docs'

// Canvas hex, not the Tailwind token — these sit as solid "cutout" shapes on
// top of a filled icon, so they need the literal color rather than a class.
const CANVAS = '#FAF8F5'

// The prototype's bottom nav skips icons entirely, but icon + label reads
// faster on a five-tab strip than a dot/pill. Solid, geometric, filled shapes
// (rather than thin outlines) match the bold rounded-square logo mark and
// extrabold headlines used everywhere else in the app — muted tan at rest,
// brand-coral only on the active tab.
function TabIcon({ name, active }: { name: IconName; active: boolean }) {
  const fill = active ? '#F1543F' : '#DCD5C9'
  const common = { width: 22, height: 22, viewBox: '0 0 24 24' }
  if (name === 'journey')
    return (
      <svg {...common}>
        <path d="M12 22c-4.2-4.2-7-8-7-11.5a7 7 0 0 1 14 0C19 14 16.2 17.8 12 22Z" fill={fill} />
        <circle cx="12" cy="10.3" r="2.6" fill={CANVAS} />
      </svg>
    )
  if (name === 'shopping')
    return (
      <svg {...common}>
        <path
          d="M5.5 8h13l-1 12.2a1.8 1.8 0 0 1-1.8 1.6H8.3a1.8 1.8 0 0 1-1.8-1.6L5.5 8Z"
          fill={fill}
        />
        <path
          d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"
          stroke={CANVAS}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    )
  if (name === 'reminders')
    return (
      <svg {...common}>
        <path
          d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5c0 4.2-1.7 5.6-1.7 5.6h14.4s-1.7-1.4-1.7-5.6A5.5 5.5 0 0 0 12 3.5Z"
          fill={fill}
        />
        <path
          d="M9.5 17.3a2.5 2.5 0 0 0 5 0"
          stroke={CANVAS}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    )
  if (name === 'essentials')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" fill={fill} />
        <circle cx="12" cy="8.3" r="1.3" fill={CANVAS} />
        <rect x="10.8" y="10.8" width="2.4" height="6" rx="1.2" fill={CANVAS} />
      </svg>
    )
  return (
    <svg {...common}>
      <path
        d="M7 3.5h7l4 4v11a1.7 1.7 0 0 1-1.7 1.7H7a1.7 1.7 0 0 1-1.7-1.7V5.2A1.7 1.7 0 0 1 7 3.5Z"
        fill={fill}
      />
      <path d="M14 3.5v3.3a1 1 0 0 0 1 1H18Z" fill={CANVAS} />
    </svg>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const canEdit = useCanEdit()
  const shows = useTripShows()
  const tripId = useTripId()
  const trip = useTrip(tripId)
  const base = `/trips/${tripId}`
  const journeyActive =
    pathname === base || pathname.includes('/zones/') || pathname.includes('/places/')
  const shoppingActive = pathname.includes('/shopping')
  const remindersActive = pathname.includes('/reminders')
  const essentialsActive = pathname.includes('/essentials')
  const docsActive = pathname.includes('/files')

  // Red dot on the Reminders tab for a push nobody's looked at yet. Visiting
  // the tab is what clears it (below); an open tab also lights up live via a
  // message from the service worker, so you don't have to switch tabs and
  // back to notice.
  const [unseenReminder, setUnseenReminder] = useState(false)
  const remindersActiveRef = useRef(remindersActive)
  remindersActiveRef.current = remindersActive

  useEffect(() => {
    let active = true
    if (remindersActive) {
      clearReminderBadge().then(() => active && setUnseenReminder(false))
    } else {
      hasUnseenReminder()
        .then((unseen) => active && setUnseenReminder(unseen))
        .catch(() => undefined)
    }
    return () => {
      active = false
    }
  }, [remindersActive])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Captured once so cleanup doesn't depend on the global still pointing at
    // the same object by the time this effect tears down.
    const container = navigator.serviceWorker
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'reminder-badge' && !remindersActiveRef.current) {
        setUnseenReminder(true)
      }
    }
    container.addEventListener('message', onMessage)
    return () => container.removeEventListener('message', onMessage)
  }, [])

  // Five tabs share a 360px phone, so the labels stay tight — otherwise
  // "Reminders"/"Essentials"/"Documents" run into each other. A restricted
  // view drops Documents, and Shopping with it when that isn't shared, and
  // gets by with three or four.
  const tab = (
    to: string,
    name: IconName,
    label: string,
    active: boolean,
    dot: boolean = false
  ) => (
    <Link
      to={to}
      className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-0.5"
    >
      <span className="relative inline-flex">
        <TabIcon name={name} active={active} />
        {dot && (
          <span
            aria-label="Unread reminder"
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-canvas"
          />
        )}
      </span>
      <span
        className={`text-[10px] tracking-tight ${active ? 'font-bold text-brand' : 'font-medium text-muted'}`}
      >
        {label}
      </span>
    </Link>
  )

  return (
    <div className="mx-auto flex min-h-dvh max-w-app flex-col bg-canvas">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-canvas/85 px-5 py-4 backdrop-blur">
        {/* min-w-0 + truncate: the search and sign-out buttons keep their size
            on a narrow phone, and the view-only chip gives up width instead.
            Tapping the mark + trip name goes back to the trips list. */}
        <Link to="/trips" className="flex min-w-0 items-center gap-2">
          <RingMark size={34} />
          <span className="truncate font-display text-lg font-bold tracking-tight">
            {/* The short label, not the title: an unnamed trip's display_title
              is a whole sentence ("Yuval and Luciana in Japan") and would
              arrive here truncated to nothing useful, so the country stands
              in for it. */}
            {trip.data?.trip.name || trip.data?.trip.country || ' '}
          </span>
          {!canEdit && (
            <span className="chip shrink-0 truncate bg-canvas text-[10px] font-bold text-muted">
              View only
            </span>
          )}
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to={`${base}/search`}
            aria-label="Search"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white text-ink active:scale-95"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </Link>
          <SignOutButton />
        </div>
      </header>
      {/* Keyed by pathname so switching tabs — or drilling into a zone/place —
          always remounts and replays the fade, even between two routes that'd
          otherwise reuse the same component instance. */}
      <main key={pathname} className="page-transition flex-1 px-5 pb-28 pt-1">
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex max-w-app px-4 py-1.5">
          {tab(base, 'journey', 'Journey', journeyActive)}
          {shows.shopping && tab(`${base}/shopping`, 'shopping', 'Shopping', shoppingActive)}
          {tab(`${base}/reminders`, 'reminders', 'Reminders', remindersActive, unseenReminder)}
          {tab(`${base}/essentials`, 'essentials', 'Essentials', essentialsActive)}
          {canEdit && tab(`${base}/files`, 'docs', 'Documents', docsActive)}
        </div>
      </nav>
    </div>
  )
}
