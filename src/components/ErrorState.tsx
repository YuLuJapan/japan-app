// Clear error + retry path (FR-013) — shown whenever data can't be fetched/saved.
export function ErrorState({
  message = 'Could not load this right now.',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-brand/20 bg-brand/5 px-4 py-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/10 text-xl text-brand">!</span>
      <p className="text-sm font-medium text-ink">{message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
