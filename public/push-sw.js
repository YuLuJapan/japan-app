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
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      // one notification per reminder — a re-send replaces rather than stacks
      tag: data.tag || 'reminder',
      renotify: true,
      data: { url: data.url || '/reminders' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/reminders'
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
