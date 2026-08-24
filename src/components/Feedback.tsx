// What a save looks like while it is happening, and once it is over.
//
// Every POST/PATCH/DELETE in this app goes through TanStack Query, so both
// halves can be read centrally rather than wired into each of the forty-odd
// forms and swipe rows: `useIsMutating` counts what is in flight, and the
// MutationCache in api/queryClient.ts pushes the outcome into lib/toast.
//
// Rendered through a portal for the same reason ConfirmDialog is: `fixed`
// resolves against the nearest transformed ancestor, and the page-transition
// animation puts one of those around every screen.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useIsMutating } from '@tanstack/react-query'
import { dismissToast, getToasts, subscribeToToasts } from '../lib/toast'

/**
 * True while a write is in flight — but only once it has been in flight long
 * enough to be worth saying so. A local edit against a warm connection is done inside
 * 100ms, and a spinner that appears and vanishes in that time reads as a
 * flicker rather than as feedback.
 */
function useBusyLongEnough(delayMs = 250): boolean {
  const mutating = useIsMutating()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!mutating) {
      setShown(false)
      return
    }
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => clearTimeout(timer)
  }, [mutating, delayMs])
  return shown
}

/** "Working", not "Saving": the same pill covers a delete. */
function BusyPill() {
  return (
    <div
      role="status"
      className="pointer-events-none flex items-center gap-2 rounded-full bg-ink/90 px-4 py-2 text-sm font-semibold text-white shadow-pop"
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      Working…
    </div>
  )
}

/**
 * The stack sits above the tab bar rather than at the top of the screen: the
 * header is sticky and translucent, and a phone is held from below.
 */
export function Feedback() {
  const toasts = useSyncExternalStore(subscribeToToasts, getToasts, getToasts)
  const busy = useBusyLongEnough()
  if (!busy && toasts.length === 0) return null
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 mx-auto flex max-w-app flex-col items-center gap-2 px-5">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismissToast(toast.id)}
          // Assertive for a failure — it is the only sign that the tap the
          // traveller has already walked away from did not take.
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          className={`pointer-events-auto w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold shadow-pop ${
            toast.tone === 'error' ? 'bg-brand text-white' : 'bg-ink text-white'
          }`}
        >
          {toast.message}
        </button>
      ))}
      {busy && <BusyPill />}
    </div>,
    document.body
  )
}
