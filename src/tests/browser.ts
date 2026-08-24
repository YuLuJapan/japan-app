// Browser capabilities jsdom does not implement.
//
// These are not stand-ins for anything this app owns. `pushSupport()` decides
// what the notifications card offers by asking what the browser can do, and
// the reminders badge asks the service worker what is in the notification
// tray — jsdom has neither. Supplying them lets those functions run for real;
// only the platform beneath them is arranged.
import { afterEach } from 'vitest'

const restores: (() => void)[] = []

/** Defines a global for one test, and remembers how to put it back. */
function define(target: object, key: string, value: unknown): void {
  const had = key in target
  const previous = (target as Record<string, unknown>)[key]
  Object.defineProperty(target, key, { value, configurable: true, writable: true })
  restores.push(() => {
    if (had)
      Object.defineProperty(target, key, { value: previous, configurable: true, writable: true })
    else delete (target as Record<string, unknown>)[key]
  })
}

/** One notification in the tray, and whether anything has dismissed it. */
export interface TrayNotification {
  closed: boolean
  close(): void
}

export interface BrowserPush {
  /** What the service worker would report as showing. */
  tray: TrayNotification[]
  /** A push arriving while another tab is open, as the worker relays it. */
  deliver(data: unknown): void
}

const notification = (): TrayNotification => {
  const entry: TrayNotification = {
    closed: false,
    close() {
      entry.closed = true
    },
  }
  return entry
}

/**
 * A browser that can take web push: a service worker, notifications and a
 * push manager. `pushSupport()` reads all three and answers 'ready'.
 *
 * `pending` seeds the notification tray, which is what `hasUnseenReminder`
 * counts and what `clearReminderBadge` closes.
 */
export function withPushCapableBrowser({ pending = 0 } = {}): BrowserPush {
  const tray = Array.from({ length: pending }, notification)
  const listeners: Record<string, (event: MessageEvent) => void> = {}

  const registration = {
    getNotifications: async () => tray.filter((n) => !n.closed),
    pushManager: { getSubscription: async () => null },
  }

  define(navigator, 'serviceWorker', {
    getRegistration: async () => registration,
    register: async () => registration,
    addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
      listeners[type] = handler
    },
    removeEventListener: (type: string) => {
      delete listeners[type]
    },
  })
  define(window, 'Notification', { permission: 'default' })
  define(window, 'PushManager', function PushManager() {})

  return {
    tray,
    deliver: (data) => listeners.message?.(new MessageEvent('message', { data })),
  }
}

/**
 * An iPhone in a Safari tab: iOS 16.4 only exposes PushManager to an app on
 * the Home Screen, so in a tab it is simply absent — which is what makes
 * 'needs-install' a real state rather than a failure.
 */
export function withIphoneInASafariTab(): void {
  define(navigator, 'userAgent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari')
  define(window, 'Notification', { permission: 'default' })
  define(navigator, 'serviceWorker', { getRegistration: async () => undefined })
  delete (window as unknown as Record<string, unknown>).PushManager
}

afterEach(() => {
  while (restores.length) restores.pop()!()
})
