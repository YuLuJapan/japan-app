// What to do when a screen's own code will not arrive.
//
// The map is the only route behind a dynamic `import()`, which buys the entry
// bundle a great deal and costs one failure mode nothing else in the app has:
// **the file the page asks for may no longer exist.** Every asset is named by
// its content hash and only the current deployment's assets are served, so a
// page that has been open across a deploy — or a phone whose service worker
// has updated underneath it, which is what `registerType: 'autoUpdate'` does —
// asks for a chunk by a name that now 404s. The browser reports it as
// "Importing a module script failed" (Safari's wording) or "Failed to fetch
// dynamically imported module" (Chrome's), React re-throws it out of
// `Suspense`, and with nothing to catch it the router paints its own
// "Unexpected Application Error" over the whole screen — a stack trace, on a
// phone, on a trip.
//
// **A stale page is fixed by not being stale**, so the first answer is one
// reload: the service worker has already installed the new build by the time
// the old chunk goes missing, so the page comes back on it and the screen
// opens. That is a reload the app performs *on itself*, so the guard against
// doing it twice matters more than the reload does — a boundary that reloads
// on every failure is an infinite loop wearing a recovery strategy's clothes.
// The mark is a timestamp rather than a flag: a second deploy an hour later in
// the same tab deserves the same one reload, and nothing has to remember to
// clear it.
//
// Past that one attempt it stops and says so, plainly, with the way on — which
// is the same answer this app gives everywhere else something cannot be
// fetched. A render error that is *not* a missing chunk is caught here too and
// gets the honest version of the message rather than a reload it would only
// repeat.
import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { canRecoverFromStaleChunk, isChunkLoadError, recoverFromStaleChunk } from '../lib/chunks'
import { captureError } from '../lib/posthog'
import { reloadPage } from '../lib/reload'

interface State {
  /** What went wrong, or nothing. A missing chunk is worth its own message. */
  failure: 'none' | 'chunk' | 'other'
  /** True between catching and the page going away, so nothing flashes. */
  reloading: boolean
}

export class ChunkBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failure: 'none', reloading: false }

  static getDerivedStateFromError(error: unknown): State {
    return {
      failure: isChunkLoadError(error) ? 'chunk' : 'other',
      reloading: canRecoverFromStaleChunk(error),
    }
  }

  componentDidCatch(error: unknown) {
    // Reported either way: a chunk that will not load is invisible from the
    // outside precisely because the recovery works, and "how often does the
    // app have to restart itself" is the number worth having.
    captureError(error, 'chunk', { recovered: canRecoverFromStaleChunk(error) })
    recoverFromStaleChunk(error)
  }

  render() {
    if (this.state.failure === 'none') return this.props.children
    // The page is on its way out; a message would be a flash of the wrong
    // thing rather than an answer.
    if (this.state.reloading) return null
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <span className="text-5xl" aria-hidden="true">
          {this.state.failure === 'chunk' ? '🛠️' : '😵'}
        </span>
        <p className="text-sm text-muted">
          {this.state.failure === 'chunk'
            ? 'This screen could not be loaded. The app updates itself in the background, and one that was left open can be a version behind — closing and reopening it usually settles that.'
            : 'Something went wrong on this screen.'}
        </p>
        <button type="button" onClick={reloadPage} className="btn-primary">
          Try again
        </button>
        <Link to="/trips" className="text-sm font-semibold text-brand underline underline-offset-2">
          Back to your trips
        </Link>
      </div>
    )
  }
}
