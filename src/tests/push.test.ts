import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearReminderBadge, hasUnseenReminder } from '../lib/push'

afterEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error test-only cleanup of stubbed navigator properties
  delete navigator.serviceWorker
  // @ts-expect-error test-only cleanup of stubbed navigator properties
  delete navigator.clearAppBadge
  // Left behind, this makes the *next* test's browser look push-capable —
  // which is exactly the support state these tests turn on.
  // @ts-expect-error test-only cleanup of a stubbed global
  delete window.PushManager
})

/**
 * A browser with service workers and no notifications: iOS Safari in a tab,
 * which this app calls `needs-install`. The registration is real; the
 * Notifications API's extension to it — `getNotifications` — is not there.
 */
function stubWithoutNotifications() {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: () => Promise.resolve({}) },
  })
}

function stubReady(notifications: { close: () => void }[]) {
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function () {} })
  if (!('Notification' in window)) {
    Object.defineProperty(window, 'Notification', { configurable: true, value: function () {} })
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: () =>
        Promise.resolve({
          getNotifications: () => Promise.resolve(notifications),
        }),
    },
  })
}

describe('hasUnseenReminder', () => {
  it('is false when this browser cannot receive push at all (no service worker mocked)', async () => {
    expect(await hasUnseenReminder()).toBe(false)
  })

  it('is true when a notification is still in the tray', async () => {
    stubReady([{ close: vi.fn() }])
    expect(await hasUnseenReminder()).toBe(true)
  })

  it('is false once the tray is empty', async () => {
    stubReady([])
    expect(await hasUnseenReminder()).toBe(false)
  })

  it('never asks a browser that has no notifications at all', async () => {
    stubWithoutNotifications()
    await expect(hasUnseenReminder()).resolves.toBe(false)
  })
})

describe('clearReminderBadge', () => {
  it('is a no-op when there is no service worker to ask', async () => {
    await expect(clearReminderBadge()).resolves.toBeUndefined()
  })

  it('closes every tray notification and clears the Home Screen badge', async () => {
    const close = vi.fn()
    stubReady([{ close }, { close }])
    const clearAppBadge = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: clearAppBadge })

    await clearReminderBadge()

    expect(close).toHaveBeenCalledTimes(2)
    expect(clearAppBadge).toHaveBeenCalledTimes(1)
  })

  it('leaves the tray alone where getNotifications does not exist', async () => {
    // iOS Safari in a tab: a registration, and no Notifications API on it.
    // `registration?.getNotifications()` only ever checked that the *object*
    // was there — and it is — so this threw a TypeError, which reached the
    // Reminders tab as an unhandled rejection and was reported as an app
    // error on every visit.
    const clearAppBadge = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: clearAppBadge })
    stubWithoutNotifications()

    await expect(clearReminderBadge()).resolves.toBeUndefined()
    // The icon badge is a separate API and is cleared regardless — a missing
    // tray is no reason to leave a dot on the Home Screen icon.
    expect(clearAppBadge).toHaveBeenCalledTimes(1)
  })
})
