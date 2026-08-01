// Browser side of web push: capability detection, permission, and turning the
// PushSubscription into the shape the API stores.
//
// iOS only allows this inside a Home Screen app (iOS 16.4+) — in a Safari tab
// PushManager isn't there at all, hence the 'needs-install' state.

export type PushSupport = 'ready' | 'needs-install' | 'unsupported'

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS 13+ reports as a Mac; the touch points give it away
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as { standalone?: boolean }).standalone === true

export function pushSupport(): PushSupport {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (!('PushManager' in window))
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  return 'ready'
}

export const notificationPermission = (): NotificationPermission =>
  'Notification' in window ? Notification.permission : 'denied'

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export interface SubscriptionPayload {
  endpoint: string
  p256dh: string
  auth: string
  label?: string
}

function serialize(subscription: PushSubscription): SubscriptionPayload {
  const json = subscription.toJSON()
  return {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ready') return null
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

export class PushError extends Error {}

/**
 * Ask for permission (must be called from a tap — iOS ignores it otherwise),
 * then subscribe. Returns the payload to POST to /api/push/subscriptions.
 */
export async function enablePush(publicKey: string, label?: string): Promise<SubscriptionPayload> {
  if (pushSupport() !== 'ready') throw new PushError('Notifications are not available here')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new PushError(
      permission === 'denied'
        ? 'Notifications are blocked — allow them for this app in your phone settings'
        : 'Notification permission was dismissed'
    )
  }

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  // an old subscription from a previous key pair can't be reused
  if (existing) await existing.unsubscribe()

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  })
  return { ...serialize(subscription), label }
}

/** Unsubscribes locally; returns the endpoint so the server row can go too. */
export async function disablePush(): Promise<string | null> {
  const subscription = await currentSubscription()
  if (!subscription) return null
  const { endpoint } = subscription
  await subscription.unsubscribe()
  return endpoint
}

/**
 * Whether a push has arrived that nobody has looked at yet — drives the red
 * dot on the Reminders tab. Backed by the notification tray itself (via the
 * 'reminder' tag the service worker sends with) rather than separate storage,
 * so it can never drift from what's actually showing.
 */
export async function hasUnseenReminder(): Promise<boolean> {
  if (pushSupport() !== 'ready') return false
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return false
  const notifications = await registration.getNotifications({ tag: 'reminder' })
  return notifications.length > 0
}

/** Dismisses the tray notification and the Home Screen icon badge alike. */
export async function clearReminderBadge(): Promise<void> {
  const registration =
    'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  const notifications = (await registration?.getNotifications({ tag: 'reminder' })) ?? []
  notifications.forEach((notification) => notification.close())
  if ('clearAppBadge' in navigator) await navigator.clearAppBadge().catch(() => undefined)
}

/** A human name for this device, so the subscription list is readable. */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'Browser'
}
