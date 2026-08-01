// Push subscription registry: one row per device that turned notifications on.
// The browser hands us an endpoint + two keys; we hand them back to the push
// service when a reminder fires.
import type { DataStore, PushSubscriptionInput } from '../lib/datastore.js'
import { ApiError, notFound, validation } from '../lib/errors.js'
import { pushConfig, sendPush, type PushSender } from '../lib/push.js'

const MAX_LABEL = 80

/** The browser needs the VAPID public key to build a subscription. */
export function getPushKey(): { public_key: string | null } {
  return { public_key: pushConfig()?.publicKey ?? null }
}

function collectSubscriptionErrors(input: Partial<PushSubscriptionInput>): string[] {
  const errors: string[] = []
  const endpoint = String(input.endpoint ?? '').trim()
  if (!endpoint) errors.push('endpoint is required')
  else if (!/^https:\/\//i.test(endpoint)) errors.push('endpoint must be an https URL')
  if (!String(input.p256dh ?? '').trim()) errors.push('p256dh key is required')
  if (!String(input.auth ?? '').trim()) errors.push('auth key is required')
  if (input.label != null && String(input.label).length > MAX_LABEL)
    errors.push(`label must be at most ${MAX_LABEL} characters`)
  return errors
}

export async function registerPushSubscription(store: DataStore, body: unknown) {
  const input = (body ?? {}) as Partial<PushSubscriptionInput>
  const errors = collectSubscriptionErrors(input)
  if (errors.length) throw validation(errors)
  if (!pushConfig()) {
    throw new ApiError(
      503,
      'INTERNAL',
      'Push notifications are not configured on the server (missing VAPID keys)'
    )
  }
  const subscription = await store.savePushSubscription({
    endpoint: String(input.endpoint).trim(),
    p256dh: String(input.p256dh).trim(),
    auth: String(input.auth).trim(),
    label: input.label ? String(input.label).trim().slice(0, MAX_LABEL) : null,
  })
  // The endpoint is a device-identifying URL — no reason to echo it back.
  return { subscription: { id: subscription.id, label: subscription.label } }
}

export async function removePushSubscription(store: DataStore, endpoint: unknown) {
  const value = String(endpoint ?? '').trim()
  if (!value) throw validation(['endpoint is required'])
  const ok = await store.deletePushSubscription(value)
  if (!ok) throw notFound('Subscription')
}

/** "Send me one now" — proves the whole chain works before trusting it. */
export async function sendTestPush(
  store: DataStore,
  send: PushSender = sendPush
): Promise<{ subscriptions: number; sent: number; failed: number }> {
  if (!pushConfig()) {
    throw new ApiError(
      503,
      'INTERNAL',
      'Push notifications are not configured on the server (missing VAPID keys)'
    )
  }
  const subscriptions = await store.listPushSubscriptions()
  const result = { subscriptions: subscriptions.length, sent: 0, failed: 0 }
  for (const subscription of subscriptions) {
    const outcome = await send(subscription, {
      title: 'Japan 旅 — test',
      body: 'Notifications are working. This is what a reminder looks like.',
      url: '/reminders',
      tag: 'test',
    })
    if (outcome === 'sent') result.sent++
    else {
      result.failed++
      if (outcome === 'gone') await store.deletePushSubscription(subscription.endpoint)
    }
  }
  return result
}
