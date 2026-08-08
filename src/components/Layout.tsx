import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTrip } from '../api/hooks'
import { clearReminderBadge, hasUnseenReminder } from '../lib/push'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'
import { RingMark } from './RingMark'
import { SignOutButton } from './SignOutButton'

type IconName = 'journey' | 'shopping' | 'reminders' | 'essentials' | 'docs'

function TabIcon({
  name,
  active,
  dot = false,
}: {
  name: IconName
  active: boolean
  dot?: boolean
}) {
  const s = active ? '#F1543F' : '#7A756B'
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: s,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  let icon: ReactNode
  if (name === 'journey')
    icon = (
      <svg {...common}>
        <path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11Z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    )
  else if (name === 'shopping')
    icon = (
      <svg {...common}>
        <path d="M4 8h16l-1.2 11a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 8Z" />
        <path d="M9 11V6a3 3 0 0 1 6 0v5" />
      </svg>
    )
  else if (name === 'reminders')
    icon = (
      <svg {...common}>
        <path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
        <path d="M10.5 20a2 2 0 0 0 3 0" />
      </svg>
    )
  else if (name === 'essentials')
    icon = (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M11 12h1v4h1" />
      </svg>
    )
  else
    icon = (
      <svg {...common}>
        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
        <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
      </svg>
    )
  return (
    <span className="relative inline-flex">
      {icon}
      {dot && (
        <span
          aria-label="Unread reminder"
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-white"
        />
      )}
    </span>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const canEdit = useCanEdit()
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
  // "Reminders"/"Essentials"/"Documents" run into each other. The guest view
  // drops Documents and gets by with four.
  const tab = (
    to: string,
    name: IconName,
    label: string,
    active: boolean,
    dot: boolean = false
  ) => (
    <Link
      to={to}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-semibold tracking-tight ${
        active ? 'text-brand' : 'text-muted'
      }`}
    >
      <TabIcon name={name} active={active} dot={dot} />
      {label}
    </Link>
  )

  return (
    <div className="mx-auto flex min-h-dvh max-w-app flex-col bg-canvas">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-canvas/85 px-5 py-4 backdrop-blur">
        {/* min-w-0 + truncate: the search and sign-out buttons keep their size
            on a narrow phone, and the guest chip gives up width instead. Tapping
            the mark + trip name goes back to the trips list, like the prototype. */}
        <Link to="/trips" className="flex min-w-0 items-center gap-2">
          <RingMark size={34} />
          <span className="truncate font-display text-lg font-extrabold tracking-tight">
            {trip.data?.trip.name ?? ' '}
          </span>
          {!canEdit && (
            <span className="chip shrink-0 truncate bg-canvas text-[10px] font-bold text-muted">
              Guest · view only
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
      <main className="flex-1 px-5 pb-28 pt-1">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-app px-4">
          {tab(base, 'journey', 'Journey', journeyActive)}
          {tab(`${base}/shopping`, 'shopping', 'Shopping', shoppingActive)}
          {tab(`${base}/reminders`, 'reminders', 'Reminders', remindersActive, unseenReminder)}
          {tab(`${base}/essentials`, 'essentials', 'Essentials', essentialsActive)}
          {canEdit && tab(`${base}/files`, 'docs', 'Documents', docsActive)}
        </div>
      </nav>
    </div>
  )
}
