// Chat as a window over the screen you were already reading, not a screen of
// its own.
//
// The question is nearly always *about* what is in front of you — this day,
// this city, this restaurant — so sending it to its own page threw away the
// context and then made you navigate back to it. A sheet keeps the page there:
// it stops short of the top, so the screen underneath is still visible, and
// closing it leaves you exactly where you were rather than somewhere you have
// to find again.
//
// Rendered through a portal for the same reason `ConfirmDialog` is: `position:
// fixed` resolves against the nearest ancestor with a transform or a
// backdrop-filter rather than the viewport, and this is opened from inside a
// page that has both. Going straight to <body> keeps it a real overlay
// wherever the button was tapped.
//
// **The layer it sits on is deliberate**: `z-40` is above the tab bar (`z-20`),
// which it is meant to cover — there is a close button, so a hidden nav is not
// a trap — and below `ConfirmDialog`'s `z-50`, which has to be able to cover
// *this* when "Start over" asks whether you meant it.
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function ChatSheet({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  // Escape closes it, like every other dismissible layer in the app. Bound only
  // while it is open, so nothing is listening for a key that means something
  // else on the page underneath.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // The page underneath must not scroll while the sheet is over it: a phone
  // that scrolls the page instead of the transcript reads as a broken sheet.
  // Restored to whatever it was rather than to `''`, so this cannot quietly
  // undo a lock something else set.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      {/* The dimmed page. Tapping it closes, which is the gesture a sheet
          teaches by being one; `aria-hidden` because the close button below is
          the accessible way out and two of them would only add noise. */}
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      {/* Labelled "Trip chat" rather than "Ask about this trip": that is the
          box you type in, and two things answering to one name makes both
          ambiguous — to a screen reader, and to a test looking for the box. */}
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Trip chat"
        className="chat-sheet relative mx-auto flex h-[90dvh] w-full max-w-app flex-col overflow-hidden rounded-t-[28px] bg-canvas shadow-pop"
      >
        <header className="shrink-0 px-5 pb-3 pt-2">
          {/* Decorative: the handle says "sheet" without promising a drag this
              one does not do. The close button is the way out. */}
          <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="section-title text-brand">Ask</p>
              <h2 className="font-display text-[22px] font-bold leading-tight tracking-tight">
                About this trip
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                It knows your plan, your places and your bookings. It can’t change anything yet.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close chat"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink active:scale-95"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>
        {children}
      </section>
    </div>,
    document.body
  )
}
