import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearReminderBadge, hasUnseenReminder } from '../lib/push'

afterEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error test-only cleanup of stubbed navigator properties
  delete navigator.serviceWorker
  // @ts-expect-error test-only cleanup of stubbed navigator properties
  delete navigator.clearAppBadge
})

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

  it('is true when a "reminder"-tagged notification is still in the tray', async () => {
    stubReady([{ close: vi.fn() }])
    expect(await hasUnseenReminder()).toBe(true)
    // @ts-expect-error test-only cleanup
    delete window.PushManager
  })

  it('is false once the tray has nothing tagged "reminder"', async () => {
    stubReady([])
    expect(await hasUnseenReminder()).toBe(false)
    // @ts-expect-error test-only cleanup
    delete window.PushManager
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
    // @ts-expect-error test-only cleanup
    delete window.PushManager
  })
})
