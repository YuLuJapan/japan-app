import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, getDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import type { PushPayload, PushResult } from '../src/lib/push.js'
import { dispatchDueReminders } from '../src/services/reminders.js'
import { sendTestPush } from '../src/services/push.js'
import { OWNER_USER, PARTNER_USER, TEST_CODE, fixture } from './fixture.js'
import { asOwner as auth, useTestTokens } from './auth.js'

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()

let store: DataStore
beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
  delete process.env.CRON_SECRET
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
})

/** Records what would have been pushed; returns whatever outcome the test wants. */
function stubSender(outcome: PushResult | ((endpoint: string) => PushResult) = 'sent') {
  const calls: { endpoint: string; payload: PushPayload }[] = []
  const send = async (
    subscription: { endpoint: string },
    payload: PushPayload
  ): Promise<PushResult> => {
    calls.push({ endpoint: subscription.endpoint, payload })
    return typeof outcome === 'function' ? outcome(subscription.endpoint) : outcome
  }
  return { calls, send: send as Parameters<typeof dispatchDueReminders>[2] }
}

/** Registers a device for someone — the trip-1 owner unless told otherwise. */
const subscribe = (endpoint: string, userId: string = OWNER_USER.id) =>
  store.savePushSubscription({
    user_id: userId,
    endpoint,
    p256dh: 'key-p256dh',
    auth: 'key-auth',
    label: 'iPhone',
  })

const devicesOf = async (userId: string) =>
  (await store.listPushSubscriptionsForUsers([userId])).map((s) => s.endpoint)

describe('reminders CRUD', () => {
  it('creates a reminder and lists it', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/reminders')).send({
      title: 'Book the ryokan',
      body: 'Two people, dinner included',
      url: 'https://booking.example.com',
      remind_at: '2026-09-12T09:00:00+09:00',
      time_zone: 'Asia/Tokyo',
    })
    expect(res.status).toBe(201)
    // stored as an absolute instant, normalized to UTC
    expect(res.body.reminder.remind_at).toBe('2026-09-12T00:00:00.000Z')
    expect(res.body.reminder.sent_at).toBeNull()

    const list = await auth(request(app).get('/api/trips/trip-1/reminders'))
    expect(list.body.reminders).toHaveLength(1)
    expect(list.body.reminders[0].title).toBe('Book the ryokan')
  })

  it('lists reminders soonest first', async () => {
    for (const [title, at] of [
      ['later', '2026-09-20T10:00:00Z'],
      ['sooner', '2026-09-12T10:00:00Z'],
    ]) {
      await auth(request(app).post('/api/trips/trip-1/reminders')).send({ title, remind_at: at })
    }
    const list = await auth(request(app).get('/api/trips/trip-1/reminders'))
    expect(list.body.reminders.map((r: { title: string }) => r.title)).toEqual(['sooner', 'later'])
  })

  it('collects every validation error at once', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/reminders')).send({
      title: '   ',
      remind_at: 'next tuesday',
      url: 'ftp://nope',
      time_zone: 'Mars/Olympus',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    const details = res.body.error.details.join(' ')
    expect(details).toMatch(/title is required/)
    expect(details).toMatch(/remind_at/)
    expect(details).toMatch(/url/)
    expect(details).toMatch(/time_zone/)
  })

  it('401s without the access code', async () => {
    const res = await request(app).get('/api/trips/trip-1/reminders')
    expect(res.status).toBe(401)
  })

  it('patches and deletes', async () => {
    const created = await auth(request(app).post('/api/trips/trip-1/reminders')).send({
      title: 'Book something',
      remind_at: '2026-09-12T09:00:00Z',
    })
    const id = created.body.reminder.id

    const patched = await auth(request(app).patch(`/api/trips/trip-1/reminders/${id}`)).send({
      title: 'Book the bus seats',
    })
    expect(patched.status).toBe(200)
    expect(patched.body.reminder.title).toBe('Book the bus seats')

    expect((await auth(request(app).delete(`/api/trips/trip-1/reminders/${id}`))).status).toBe(204)
    expect((await auth(request(app).delete(`/api/trips/trip-1/reminders/${id}`))).status).toBe(404)
  })

  it('re-arms a sent reminder when it is moved into the future', async () => {
    const reminder = await store.createReminder({
      trip_id: 'trip-1',
      title: 'Book',
      remind_at: '2026-09-12T09:00:00.000Z',
    })
    await store.updateReminder('trip-1', reminder.id, { sent_at: '2026-09-12T09:01:00.000Z' })

    const res = await auth(request(app).patch(`/api/trips/trip-1/reminders/${reminder.id}`)).send({
      remind_at: '2026-09-20T09:00:00.000Z',
    })
    expect(res.body.reminder.sent_at).toBeNull()
  })
})

describe('trip-scoped reminder routes', () => {
  it('GET/POST /api/trips/:tripId/reminders are isolated from the legacy default trip', async () => {
    const trip2 = await auth(request(app).post('/api/trips')).send({
      name: 'Dolomites',
      start_date: '2027-02-06',
      end_date: '2027-02-14',
    })
    const tripId = trip2.body.trip.id

    const created = await auth(request(app).post(`/api/trips/${tripId}/reminders`)).send({
      title: 'Book the mountain hut',
      remind_at: '2027-01-01T09:00:00Z',
    })
    expect(created.status).toBe(201)
    expect(created.body.reminder.trip_id).toBe(tripId)

    const trip2List = await auth(request(app).get(`/api/trips/${tripId}/reminders`))
    expect(trip2List.body.reminders.map((r: { title: string }) => r.title)).toEqual([
      'Book the mountain hut',
    ])

    const trip1List = await auth(request(app).get('/api/trips/trip-1/reminders'))
    expect(trip1List.body.reminders).toEqual([])
  })

  it('404s for an unknown trip', async () => {
    const res = await auth(request(app).get('/api/trips/nope/reminders'))
    expect(res.status).toBe(404)
  })
})

describe('dispatch', () => {
  const due = () =>
    store.createReminder({
      trip_id: 'trip-1',
      title: 'Book the ryokan',
      body: 'Counter seats',
      url: 'https://booking.example.com',
      remind_at: '2026-09-12T09:00:00.000Z',
      time_zone: 'Asia/Tokyo',
    })

  it("sends due reminders to the trip members' devices and marks them sent", async () => {
    const reminder = await due()
    await subscribe('https://push.example.com/a')
    await subscribe('https://push.example.com/b')
    const push = stubSender()

    const result = await dispatchDueReminders(store, new Date('2026-09-12T09:04:00Z'), push.send)

    expect(result).toMatchObject({ due: 1, subscriptions: 2, sent: 2, failed: 0, dropped: 0 })
    expect(push.calls[0].payload).toMatchObject({
      title: 'Book the ryokan',
      body: 'Counter seats',
      url: 'https://booking.example.com',
    })
    expect((await store.getReminder('trip-1', reminder.id))!.sent_at).not.toBeNull()
  })

  // The whole point of push_subscriptions.user_id. Before it, dispatch read
  // every registered device and sent every due reminder to all of them: a
  // stranger who turned notifications on received the travellers' reminder
  // titles, which are free text.
  it("never reaches a device belonging to someone who isn't on the trip", async () => {
    await due()
    await subscribe('https://push.example.com/member')
    // PARTNER_USER owns trip-2 and is not a member of trip-1.
    await subscribe('https://push.example.com/stranger', PARTNER_USER.id)
    const push = stubSender()

    const result = await dispatchDueReminders(store, new Date('2026-09-12T09:04:00Z'), push.send)

    expect(push.calls.map((c) => c.endpoint)).toEqual(['https://push.example.com/member'])
    expect(result).toMatchObject({ due: 1, subscriptions: 1, sent: 1 })
  })

  it("sends each trip's reminders only to that trip, in one run", async () => {
    await due()
    await store.createReminder({
      trip_id: 'trip-2',
      title: 'Someone else’s errand',
      body: null,
      url: null,
      remind_at: '2026-09-12T09:00:00.000Z',
      time_zone: 'Europe/Rome',
    })
    await subscribe('https://push.example.com/mine')
    await subscribe('https://push.example.com/theirs', PARTNER_USER.id)
    const push = stubSender()

    const result = await dispatchDueReminders(store, new Date('2026-09-12T09:04:00Z'), push.send)

    expect(result).toMatchObject({ due: 2, subscriptions: 2, sent: 2 })
    expect(push.calls).toEqual([
      expect.objectContaining({
        endpoint: 'https://push.example.com/mine',
        payload: expect.objectContaining({ title: 'Book the ryokan' }),
      }),
      expect.objectContaining({
        endpoint: 'https://push.example.com/theirs',
        payload: expect.objectContaining({ title: 'Someone else’s errand' }),
      }),
    ])
  })

  it('leaves future reminders alone', async () => {
    await due()
    await subscribe('https://push.example.com/a')
    const push = stubSender()

    const result = await dispatchDueReminders(store, new Date('2026-09-12T08:59:00Z'), push.send)
    expect(result.due).toBe(0)
    expect(push.calls).toHaveLength(0)
  })

  it('never sends the same reminder twice', async () => {
    await due()
    await subscribe('https://push.example.com/a')
    const push = stubSender()

    await dispatchDueReminders(store, new Date('2026-09-12T09:04:00Z'), push.send)
    const second = await dispatchDueReminders(store, new Date('2026-09-12T09:09:00Z'), push.send)

    expect(second.due).toBe(0)
    expect(push.calls).toHaveLength(1)
  })

  it('drops subscriptions the push service reports as gone', async () => {
    await due()
    await subscribe('https://push.example.com/dead')
    await subscribe('https://push.example.com/live')
    const push = stubSender((endpoint) => (endpoint.endsWith('dead') ? 'gone' : 'sent'))

    const result = await dispatchDueReminders(store, new Date('2026-09-12T09:04:00Z'), push.send)

    expect(result).toMatchObject({ sent: 1, dropped: 1 })
    expect(await devicesOf(OWNER_USER.id)).toEqual(['https://push.example.com/live'])
  })
})

describe('dispatch endpoint auth', () => {
  it('rejects an unauthenticated call', async () => {
    const res = await request(app).get('/api/reminders/dispatch')
    expect(res.status).toBe(401)
  })

  it('accepts the cron secret as a bearer token or ?key=', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    const bearer = await request(app)
      .get('/api/reminders/dispatch')
      .set('Authorization', 'Bearer cron-secret')
    expect(bearer.status).toBe(200)
    expect(bearer.body).toMatchObject({ due: 0 })

    const query = await request(app).post('/api/reminders/dispatch?key=cron-secret')
    expect(query.status).toBe(200)

    const wrong = await request(app).get('/api/reminders/dispatch?key=nope')
    expect(wrong.status).toBe(401)
  })

  it('falls back to the trip access code when no cron secret is set', async () => {
    // The deprecated code, not an account: the scheduler has no session.
    const res = await request(app)
      .get('/api/reminders/dispatch')
      .set('Authorization', `Bearer ${TEST_CODE}`)
    expect(res.status).toBe(200)
  })
})

describe('push subscriptions', () => {
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key'
    process.env.VAPID_PRIVATE_KEY = 'test-private-key'
  })

  it('reports the public key to the browser', async () => {
    const res = await auth(request(app).get('/api/push/key'))
    expect(res.body).toEqual({ public_key: 'test-public-key' })
  })

  it('reports no key when the server has none', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    const res = await auth(request(app).get('/api/push/key'))
    expect(res.body).toEqual({ public_key: null })
  })

  it('registers a device, upserting on the endpoint, and unregisters it', async () => {
    const body = {
      endpoint: 'https://push.example.com/a',
      p256dh: 'p1',
      auth: 'a1',
      label: 'iPhone',
    }
    expect((await auth(request(app).post('/api/push/subscriptions')).send(body)).status).toBe(201)
    await auth(request(app).post('/api/push/subscriptions')).send({ ...body, p256dh: 'p2' })

    const saved = await (await getDataStore()).listPushSubscriptionsForUsers([OWNER_USER.id])
    expect(saved).toHaveLength(1)
    expect(saved[0].p256dh).toBe('p2')

    const removed = await auth(
      request(app).delete(`/api/push/subscriptions?endpoint=${encodeURIComponent(body.endpoint)}`)
    )
    expect(removed.status).toBe(204)
    expect(await devicesOf(OWNER_USER.id)).toHaveLength(0)
  })

  it('rejects a malformed subscription', async () => {
    const res = await auth(request(app).post('/api/push/subscriptions')).send({ endpoint: 'nope' })
    expect(res.status).toBe(400)
    const details = res.body.error.details.join(' ')
    expect(details).toMatch(/endpoint/)
    expect(details).toMatch(/p256dh/)
    expect(details).toMatch(/auth/)
  })

  it('refuses to register when the server has no VAPID keys', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    const res = await auth(request(app).post('/api/push/subscriptions')).send({
      endpoint: 'https://push.example.com/a',
      p256dh: 'p1',
      auth: 'a1',
    })
    expect(res.status).toBe(503)
  })

  it('sends a test notification to my devices, and only mine', async () => {
    await subscribe('https://push.example.com/mine')
    await subscribe('https://push.example.com/theirs', PARTNER_USER.id)
    const push = stubSender()
    const result = await sendTestPush(
      store,
      OWNER_USER.id,
      push.send as Parameters<typeof sendTestPush>[2]
    )
    expect(result).toMatchObject({ subscriptions: 1, sent: 1, failed: 0 })
    expect(push.calls.map((c) => c.endpoint)).toEqual(['https://push.example.com/mine'])
    expect(push.calls[0].payload.title).toMatch(/test/i)
  })

  it("refuses to unregister someone else's device", async () => {
    await subscribe('https://push.example.com/theirs', PARTNER_USER.id)
    const res = await auth(
      request(app).delete(
        `/api/push/subscriptions?endpoint=${encodeURIComponent('https://push.example.com/theirs')}`
      )
    )
    // 404, not 403: there is nothing to confirm to a caller it isn't theirs.
    expect(res.status).toBe(404)
    expect(await devicesOf(PARTNER_USER.id)).toHaveLength(1)
  })

  it('re-registering moves the device to whoever is signed in now', async () => {
    await subscribe('https://push.example.com/shared', PARTNER_USER.id)
    const res = await auth(request(app).post('/api/push/subscriptions')).send({
      endpoint: 'https://push.example.com/shared',
      p256dh: 'p1',
      auth: 'a1',
    })
    expect(res.status).toBe(201)
    expect(await devicesOf(OWNER_USER.id)).toEqual(['https://push.example.com/shared'])
    expect(await devicesOf(PARTNER_USER.id)).toHaveLength(0)
  })
})
