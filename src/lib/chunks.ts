// A chunk of the app that will not load, and the one reload that fixes it.
//
// Every asset is named by its content hash and only the current deployment's
// assets are served, so a page that has been open across a deploy — or one
// whose service worker has updated underneath it, which is what
// `registerType: 'autoUpdate'` does — asks for a file by a name that now
// 404s. Anything reached by a dynamic `import()` can hit this: the map route
// itself, and Leaflet's engine, which is deliberately kept out of the precache
// and therefore always comes from the network.
//
// **A stale page is fixed by not being stale.** The service worker has already
// installed the new build by the time the old file goes missing, so one reload
// brings the page back on it. The guard against doing that twice matters more
// than the reload does — anything that reloads on every failure is an infinite
// loop wearing a recovery strategy's clothes.
//
// The mark is a timestamp rather than a flag, so a second deploy an hour later
// in the same tab gets its own attempt and nothing has to remember to clear
// it.
import { reloadPage } from './reload'

const MARK = 'onward:chunk-reload'

/**
 * How long a reload counts as "just tried". Long enough that a boot which
 * fails the same way lands inside it, short enough that the next deploy in a
 * long-lived tab is a fresh chance rather than a screen that refuses to retry.
 */
const RECENT_MS = 10_000

/**
 * Whether the browser is telling us a module would not load, in the words each
 * engine happens to use for it. Matched on the message because there is no
 * error type to check: a failed dynamic import is a plain `TypeError`.
 *
 * The CSS wording belongs here too — Vite preloads a lazy chunk's stylesheet
 * and rejects the whole import if it cannot, which is how Leaflet's stylesheet
 * takes the map down with it.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|unable to preload/i.test(
    message
  )
}

// Both guarded: a browser set to block site data throws on the accessor
// itself, and a caller that cannot read its own mark should still show its
// message rather than fall over on a second error.
const reloadedRecently = () => {
  try {
    return Date.now() - Number(sessionStorage.getItem(MARK) ?? 0) < RECENT_MS
  } catch {
    // No memory of a reload means no protection from looping, so the safe
    // reading is that one has just happened.
    return true
  }
}

/**
 * Whether the one reload is still available for this error — asked separately
 * so a component can render *nothing* on the way out rather than flashing a
 * message the reload is about to discard.
 *
 * **A browser that says it is offline is a reason not to reload.** The fetch
 * failed because there is no network, the reload would fail the same way, and
 * it would spend the single attempt that a genuinely stale page needs.
 */
export function canRecoverFromStaleChunk(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return !reloadedRecently()
}

/** Take the one reload if it is still available. True when the page is going. */
export function recoverFromStaleChunk(error: unknown): boolean {
  if (!canRecoverFromStaleChunk(error)) return false
  try {
    sessionStorage.setItem(MARK, String(Date.now()))
  } catch {
    /* private browsing; `reloadedRecently` has already refused the reload */
  }
  reloadPage()
  return true
}
