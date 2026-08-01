// Scheduled reminders: "book the ryokan on the 12th at 9am". Stored as an
// absolute instant so a phone still on Israel time and one already on Japan
// time agree on when it fires; `time_zone` only records which wall clock the
// user typed, for display.
import type { DataStore, Reminder, ReminderInput } from '../lib/datastore.js'
import { notFound, validation } from '../lib/errors.js'
import { sendPush, type PushSender } from '../lib/push.js'

// Reminders are planned in Israel time unless the client says otherwise (the
// app's zone chip always sends one explicitly; this is the fallback).
const DEFAULT_TIME_ZONE = 'Asia/Jerusalem'
const MAX_TITLE = 120
const MAX_BODY = 500
const MAX_URL = 500

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Collects every problem at once (same contract as collectPlaceErrors). */
function collectReminderErrors(input: Partial<ReminderInput>, partial: boolean): string[] {
  const errors: string[] = []

  if (input.title !== undefined || !partial) {
    const title = (input.title ?? '').trim()
    if (!title) errors.push('title is required')
    else if (title.length > MAX_TITLE) errors.push(`title must be at most ${MAX_TITLE} characters`)
  }

  if (input.body != null) {
    if (typeof input.body !== 'string') errors.push('body must be a string')
    else if (input.body.trim().length > MAX_BODY)
      errors.push(`body must be at most ${MAX_BODY} characters`)
  }

  if (input.url != null && String(input.url).trim()) {
    const url = String(input.url).trim()
    if (url.length > MAX_URL) errors.push(`url must be at most ${MAX_URL} characters`)
    // absolute link (booking site) or in-app path (/places/…)
    else if (!/^https?:\/\//i.test(url) && !url.startsWith('/'))
      errors.push('url must start with http://, https:// or /')
  }

  if (input.remind_at !== undefined || !partial) {
    const at = String(input.remind_at ?? '')
    if (!at) errors.push('remind_at is required')
    else if (Number.isNaN(Date.parse(at)))
      errors.push('remind_at must be an ISO 8601 date-time (e.g. 2026-09-12T09:00:00Z)')
  }

  if (input.time_zone != null && String(input.time_zone).trim()) {
    if (!isValidTimeZone(String(input.time_zone).trim()))
      errors.push('time_zone must be a valid IANA time zone (e.g. Asia/Tokyo)')
  }

  return errors
}

/** Normalizes user input into the stored shape (instants always UTC ISO). */
function normalize(input: Partial<ReminderInput>): Partial<ReminderInput> {
  const next: Partial<ReminderInput> = {}
  if (input.title !== undefined) next.title = String(input.title).trim()
  if (input.body !== undefined)
    next.body = input.body == null ? null : String(input.body).trim() || null
  if (input.url !== undefined)
    next.url = input.url == null ? null : String(input.url).trim() || null
  if (input.remind_at !== undefined) next.remind_at = new Date(input.remind_at).toISOString()
  if (input.time_zone !== undefined)
    next.time_zone = input.time_zone == null ? null : String(input.time_zone).trim() || null
  return next
}

async function requireTripId(store: DataStore): Promise<string> {
  const trip = await store.getTrip()
  if (!trip) throw notFound('Trip')
  return trip.id
}

export async function listReminders(store: DataStore): Promise<{ reminders: Reminder[] }> {
  const tripId = await requireTripId(store)
  return { reminders: await store.listReminders(tripId) }
}

export async function createReminder(store: DataStore, body: unknown) {
  const input = (body ?? {}) as Partial<ReminderInput>
  const errors = collectReminderErrors(input, false)
  if (errors.length) throw validation(errors)
  const tripId = await requireTripId(store)
  const normalized = normalize(input)
  const reminder = await store.createReminder({
    trip_id: tripId,
    title: normalized.title!,
    body: normalized.body ?? null,
    url: normalized.url ?? null,
    remind_at: normalized.remind_at!,
    time_zone: normalized.time_zone ?? DEFAULT_TIME_ZONE,
  })
  return { reminder }
}

export async function updateReminder(store: DataStore, reminderId: string, body: unknown) {
  const input = (body ?? {}) as Partial<ReminderInput>
  const errors = collectReminderErrors(input, true)
  if (errors.length) throw validation(errors)
  const patch: Partial<ReminderInput> & { sent_at?: string | null } = normalize(input)
  // Moving a fired reminder into the future re-arms it (that's the "snooze").
  if (patch.remind_at) {
    const existing = await store.getReminder(reminderId)
    if (existing?.sent_at && patch.remind_at > existing.sent_at) patch.sent_at = null
  }
  const reminder = await store.updateReminder(reminderId, patch)
  if (!reminder) throw notFound('Reminder')
  return { reminder }
}

export async function deleteReminder(store: DataStore, reminderId: string) {
  const ok = await store.deleteReminder(reminderId)
  if (!ok) throw notFound('Reminder')
}

export interface DispatchResult {
  due: number
  subscriptions: number
  sent: number
  failed: number
  dropped: number
}

/**
 * Fire every reminder whose time has passed. Called by the cron pinger every
 * few minutes — see README "Reminders & notifications". Claims first, so a
 * slow run overlapping the next one can't double-send.
 */
export async function dispatchDueReminders(
  store: DataStore,
  now: Date = new Date(),
  send: PushSender = sendPush
): Promise<DispatchResult> {
  const due = await store.claimDueReminders(now.toISOString())
  const result: DispatchResult = {
    due: due.length,
    subscriptions: 0,
    sent: 0,
    failed: 0,
    dropped: 0,
  }
  if (!due.length) return result

  const subscriptions = await store.listPushSubscriptions()
  result.subscriptions = subscriptions.length

  const dropped = new Set<string>()
  for (const reminder of due) {
    for (const subscription of subscriptions) {
      if (dropped.has(subscription.endpoint)) continue
      const outcome = await send(subscription, {
        title: reminder.title,
        body: reminder.body,
        url: reminder.url,
        tag: `reminder-${reminder.id}`,
      })
      if (outcome === 'sent') result.sent++
      else if (outcome === 'gone') {
        dropped.add(subscription.endpoint)
        await store.deletePushSubscription(subscription.endpoint)
        result.dropped++
      } else result.failed++
    }
  }
  return result
}
