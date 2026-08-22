// Is this link safe to put in an href, or to hand to `clients.openWindow()`?
//
// The subtle case is the in-app path. "Starts with a slash" reads like "stays
// on this site", and it does not: `//evil.com` starts with a slash and is a
// *protocol-relative URL* — the browser fills in the current scheme and
// navigates off-site. `/\evil.com` is read the same way by every major browser.
//
// A reminder's URL is rendered as a link in the app and, more importantly,
// opened by the service worker when the notification is tapped — which is
// exactly the moment a person taps without reading. Anyone who can write to a
// trip could plant a notification that takes their fellow travellers wherever
// they like, wearing the trip's context. Not remote takeover, but a good
// phishing primitive, and free to close.

/** Browsers ignore tabs and newlines inside a URL, so strip them before judging. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const strip = (raw: string) => raw.replace(/[\u0000-\u0020\u007f]/g, '')

/** An absolute link to somewhere else — a booking site, a map, a shop. */
export const isAbsoluteHttpUrl = (raw: string) => /^https?:\/\//i.test(strip(raw))

/** A path inside this app, and genuinely inside it. */
export function isInAppPath(raw: string): boolean {
  const url = strip(raw)
  return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')
}

/** What a reminder may link to: off-site over http(s), or a page in the app. */
export const isSafeLinkTarget = (raw: string) => isAbsoluteHttpUrl(raw) || isInAppPath(raw)
