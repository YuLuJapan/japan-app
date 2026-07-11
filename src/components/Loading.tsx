export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-muted" role="status">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-line border-t-brand" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  )
}
