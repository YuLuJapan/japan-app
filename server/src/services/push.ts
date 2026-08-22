// Push subscription registry: one row per device that turned notifications on,
// recorded against the account that turned it on. The browser hands us an
// endpoint + two keys; we hand them back to the push service when a reminder
// on one of that account's trips fires.
//
// Every function here takes the caller's user id first, in the same spirit as
// the tripId-first DataStore methods: the scope is an argument, not something
// the implementation is trusted to remember.
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

export async function registerPushSubscription(store: DataStore, userId: string, body: unknown) {
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
    user_id: userId,
    endpoint: String(input.endpoint).trim(),
    p256dh: String(input.p256dh).trim(),
    auth: String(input.auth).trim(),
    label: input.label ? String(input.label).trim().slice(0, MAX_LABEL) : null,
  })
  // The endpoint is a device-identifying URL — no reason to echo it back.
  return { subscription: { id: subscription.id, label: subscription.label } }
}

export async function removePushSubscription(store: DataStore, userId: string, endpoint: unknown) {
  const value = String(endpoint ?? '').trim()
  if (!value) throw validation(['endpoint is required'])
  // Someone else's device answers 404, same as one that was never registered:
  // there is nothing to confirm to a caller it doesn't belong to.
  const ok = await store.deletePushSubscription(userId, value)
  if (!ok) throw notFound('Subscription')
}

/** "Send me one now" — proves the whole chain works before trusting it. */
export async function sendTestPush(
  store: DataStore,
  userId: string,
  send: PushSender = sendPush
): Promise<{ subscriptions: number; sent: number; failed: number }> {
  if (!pushConfig()) {
    throw new ApiError(
      503,
      'INTERNAL',
      'Push notifications are not configured on the server (missing VAPID keys)'
    )
  }
  // Your own devices only — "send me one now" means me.
  const subscriptions = await store.listPushSubscriptionsForUsers([userId])
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
      if (outcome === 'gone') await store.deletePushSubscription(userId, subscription.endpoint)
    }
  }
  return result
}
