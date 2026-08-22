// Explicit confirmation before destructive actions (FR-017).
//
// Rendered through a portal on purpose: `position: fixed` resolves against the
// nearest ancestor that has a transform/filter/backdrop-filter rather than the
// viewport, so a dialog opened from inside the blurred sticky header came out
// clipped to the header strip. Going straight to <body> keeps it a real
// full-screen overlay wherever it is opened from.
import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {message && <p className="mt-1 text-sm text-muted">{message}</p>}
        <div className="mt-5 flex gap-3">
          <button type="button" className="btn-ghost flex-1" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn bg-brand text-white flex-1" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
