// The browser half of server/src/lib/safe-url.ts — deliberately a second
// implementation rather than an import, for the same reason trip-title.ts is
// mirrored: the server file is ESM-with-.js-extensions built for Node.
//
// The server now refuses to store an unsafe reminder URL, so this is about the
// rows written before that check existed. A stored `//evil.com` reaches the
// renderer as data, and `href={reminder.url}` would happily navigate off-site.
// Validating on write and again on render is the point — one of them is always
// the one that was missing.

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const strip = (raw: string) => raw.replace(/[\u0000-\u0020\u007f]/g, '')

export const isAbsoluteHttpUrl = (raw: string) => /^https?:\/\//i.test(strip(raw))

/** A path inside this app, and genuinely inside it — not `//evil.com`. */
export function isInAppPath(raw: string): boolean {
  const url = strip(raw)
  return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')
}

export const isSafeLinkTarget = (raw: string) => isAbsoluteHttpUrl(raw) || isInAppPath(raw)
