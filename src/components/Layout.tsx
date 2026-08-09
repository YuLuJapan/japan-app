import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTrip } from '../api/hooks'
import { clearReminderBadge, hasUnseenReminder } from '../lib/push'
import { useCanEdit } from '../lib/session'
import { useTripId } from '../lib/trip'
import { RingMark } from './RingMark'
import { SignOutButton } from './SignOutButton'

// The design prototype's bottom nav has no icons — just a small pill (active)
// or dot (inactive) above a text label.
function TabIndicator({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={`block rounded-full transition-all ${
        active ? 'h-[7px] w-[18px] bg-brand' : 'h-[7px] w-[7px] bg-[#DCD5C9]'
      }`}
    />
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
  const tab = (to: string, label: string, active: boolean, dot: boolean = false) => (
    <Link
      to={to}
      className="flex min-h-14 flex-1 flex-col items-center justify-center gap-[7px] px-0.5"
    >
      <span className="relative inline-flex">
        <TabIndicator active={active} />
        {dot && (
          <span
            aria-label="Unread reminder"
            className="absolute -right-2 -top-1.5 h-2 w-2 rounded-full bg-brand ring-2 ring-canvas"
          />
        )}
      </span>
      <span
        className={`text-[10px] tracking-tight ${active ? 'font-bold text-ink' : 'font-medium text-muted'}`}
      >
        {label}
      </span>
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
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex max-w-app px-4 py-1.5">
          {tab(base, 'Journey', journeyActive)}
          {tab(`${base}/shopping`, 'Shopping', shoppingActive)}
          {tab(`${base}/reminders`, 'Reminders', remindersActive, unseenReminder)}
          {tab(`${base}/essentials`, 'Essentials', essentialsActive)}
          {canEdit && tab(`${base}/files`, 'Documents', docsActive)}
        </div>
      </nav>
    </div>
  )
}
