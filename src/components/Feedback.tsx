// What a write looks like while it is happening, and once it is over.
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
import {
  TOAST_LIFETIME,
  dismissToast,
  getToasts,
  subscribeToToasts,
  type Toast,
  type ToastTone,
} from '../lib/toast'

/**
 * True while a write is in flight — but only once it has been in flight long
 * enough to be worth saying so. A local edit against a warm connection is done
 * inside 100ms, and a spinner that appears and vanishes in that time reads as
 * a flicker rather than as feedback.
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

/**
 * Green for done, red for didn't — the two answers a traveller reads at a
 * glance without waiting for the words. Coral carries every warning and every
 * destructive button in this app, so the failure red is the deep end of that
 * same family rather than a fifth accent, and the green is the one colour the
 * palette was missing (tailwind.config.ts). Both ends of both gradients clear
 * 5:1 against white, which 14px semibold needs and the lighter, prettier
 * versions of these two colours do not.
 */
const TONE: Record<ToastTone, { surface: string; glow: string; role: 'status' | 'alert' }> = {
  success: {
    surface: 'from-leaf to-leaf-600',
    // Its own colour under it rather than the neutral card shadow: on a
    // rice-paper canvas that is the difference between a coloured rectangle
    // and something that has just arrived.
    glow: 'shadow-[0_16px_34px_-14px_rgba(12,91,65,0.75)]',
    role: 'status',
  },
  error: {
    surface: 'from-brand-700 to-brand-800',
    glow: 'shadow-[0_16px_34px_-14px_rgba(158,43,30,0.75)]',
    role: 'alert',
  },
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  return tone === 'success' ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m5 12.6 4.4 4.4L19 7.4"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 6.5v7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="12" cy="17.6" r="1.5" fill="currentColor" />
    </svg>
  )
}

function ToastCard({ toast }: { toast: Toast }) {
  const tone = TONE[toast.tone]
  return (
    <div
      role={tone.role}
      className={`pointer-events-auto relative w-full animate-toast-in overflow-hidden rounded-[20px] bg-gradient-to-br ${tone.surface} pl-3 pr-2 py-3 text-white shadow-pop ring-1 ring-inset ring-white/20`}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-white ring-1 ring-inset ring-white/25">
          <ToneIcon tone={toast.tone} />
        </span>
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{toast.message}</p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => dismissToast(toast.id)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/15 hover:text-white active:scale-95"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M6 6l12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {/* The life it has left, drawn rather than left to guess at. Duration
          comes from the same table as the timer that dismisses it, so the bar
          reaching the edge and the toast leaving are the same moment. The
          track behind it is what keeps a half-run bar looking deliberate
          rather than like a stray highlight along the bottom edge. */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
        <span
          style={{ animationDuration: `${TOAST_LIFETIME[toast.tone]}ms` }}
          className="block h-full w-full origin-left animate-toast-timer bg-white/55"
        />
      </span>
    </div>
  )
}

/** "Working", not "Saving": the same pill covers a delete. */
function BusyPill() {
  return (
    <div
      role="status"
      className="pointer-events-none flex animate-toast-in items-center gap-2.5 rounded-full bg-ink/90 py-2.5 pl-3 pr-4 text-sm font-semibold text-white shadow-pop ring-1 ring-inset ring-white/15 backdrop-blur"
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      Working…
    </div>
  )
}

/**
 * The stack sits above the tab bar rather than at the top of the screen: the
 * header is sticky and translucent, and a phone is held from below. Newest
 * toast last, closest to the thumb that will dismiss it.
 */
export function Feedback() {
  const toasts = useSyncExternalStore(subscribeToToasts, getToasts, getToasts)
  const busy = useBusyLongEnough()
  if (!busy && toasts.length === 0) return null
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 mx-auto flex max-w-app flex-col items-center gap-2 px-5">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
      {busy && <BusyPill />}
    </div>,
    document.body
  )
}
