/* eslint-env serviceworker */
/* global self, clients */
// Push handlers, imported into the Workbox-generated service worker
// (vite.config.ts → workbox.importScripts). Kept as a plain hand-written file
// so the generated SW stays regenerable.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Japan 旅', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Japan 旅'
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/favicon-32.png',
        // one notification per reminder — a re-send replaces rather than stacks
        tag: data.tag || 'reminder',
        renotify: true,
        data: { url: data.url || '/reminders' },
      })

      // Home Screen icon badge — best-effort, unsupported browsers no-op.
      // A plain dot (no count): with renotify above there's only ever one
      // live notification anyway, so a number would be misleading.
      if ('setAppBadge' in navigator) {
        await navigator.setAppBadge().catch(() => undefined)
      }

      // Tell any open tab to light up the in-app dot without waiting for a
      // navigation — the Reminders tab is what clears both of these.
      const openClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of openClients) client.postMessage({ type: 'reminder-badge' })
    })()
  )
})

/**
 * Where a tapped notification may go.
 *
 * "Starts with a slash" is not "stays on this site": `//evil.com` is a
 * protocol-relative URL and navigates off-site, as does `/\\evil.com`.
 * The API refuses to store those now, but a row written before that fix
 * would still be sitting in someone's database — and a notification tap is
 * the least examined click there is. Anything unrecognised falls back to
 * the reminders screen.
 */
function safeTarget(url) {
  if (typeof url !== 'string' || !url) return '/reminders'
  // Browsers ignore tabs and newlines inside a URL when they navigate.
  const clean = url.replace(/[\u0000-\u0020\u007f]/g, '')
  if (/^https?:\/\//i.test(clean)) return clean
  if (clean.startsWith('/') && !clean.startsWith('//') && !clean.startsWith('/\\')) return clean
  return '/reminders'
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = safeTarget(event.notification.data && event.notification.data.url)
  const external = /^https?:\/\//i.test(target)

  event.waitUntil(
    (async () => {
      if (external) {
        await clients.openWindow(target)
        return
      }
      // in-app path: reuse the already-open window when there is one
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(target)
          return
        }
      }
      await clients.openWindow(target)
    })()
  )
})
