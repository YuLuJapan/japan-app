// The last resort: something threw during render and React has torn the tree
// down. Anything is better than the blank page you get by rendering null —
// on a phone, mid-trip, "reload" is the whole recovery path and it needs to be
// visible. Deliberately plain: this renders outside the router and the query
// client, so it can rely on nothing but Tailwind.
export function AppCrash() {
  return (
    <div className="mx-auto flex min-h-screen max-w-app flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-2xl text-brand">
        !
      </span>
      <p className="text-base font-medium text-ink">Something went wrong.</p>
      <p className="text-sm text-muted">
        The trip is safe — this screen just failed to draw. Reloading usually fixes it.
      </p>
      <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}
