// Web Push sender (VAPID). Everything here is optional at runtime: with no
// keys configured the app behaves exactly as before, the Reminders screen just
// says notifications aren't set up yet.
//
// Keys are generated once with `npm run push:keys` and stored as env vars:
//   VAPID_PUBLIC_KEY   — also served to the browser via GET /api/push/key
//   VAPID_PRIVATE_KEY  — server only, never leaves the backend
//   VAPID_SUBJECT      — mailto: or https: contact, required by the spec
import webpush from 'web-push'
import type { PushSubscriptionRecord } from './datastore.js'

export interface PushPayload {
  title: string
  body?: string | null
  url?: string | null
  tag?: string
}

/** 'sent' = accepted by the push service · 'gone' = subscription is dead, drop it. */
export type PushResult = 'sent' | 'gone' | 'error'

export interface PushConfig {
  publicKey: string
  privateKey: string
  subject: string
}

export function pushConfig(): PushConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:trip@example.com'
  return { publicKey, privateKey, subject }
}

export const pushEnabled = () => pushConfig() !== null

let configured = false

/** Configure web-push lazily so a missing key never breaks module import. */
function ensureConfigured(config: PushConfig) {
  if (configured) return
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
  configured = true
}

export async function sendPush(
  subscription: PushSubscriptionRecord,
  payload: PushPayload
): Promise<PushResult> {
  const config = pushConfig()
  if (!config) return 'error'
  ensureConfigured(config)
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 } // keep trying for a day if the phone is offline
    )
    return 'sent'
  } catch (err) {
    // 404/410 = the browser dropped this subscription (app removed, keys rotated)
    const status = (err as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) return 'gone'
    console.error('push send failed', status, (err as Error).message)
    return 'error'
  }
}

/** Injection point so tests can dispatch reminders without a real push service. */
export type PushSender = typeof sendPush
