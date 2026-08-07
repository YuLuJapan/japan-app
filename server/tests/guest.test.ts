// The guest code: sees the trip, cannot change it, and never gets a document.
// The frontend hides the buttons; these are the checks that actually hold.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { TEST_CODE, fixture } from './fixture.js'

const GUEST_CODE = 'test-guest-code'

process.env.TRIP_ACCESS_CODE = TEST_CODE
process.env.TRIP_GUEST_CODE = GUEST_CODE
const app = createApp()

const asOwner = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_CODE}`)
const asGuest = (r: request.Test) => r.set('Authorization', `Bearer ${GUEST_CODE}`)

beforeEach(() => setDataStore(createMemoryStore(fixture())))

describe('guest access code', () => {
  it('signs in and is told it is a guest', async () => {
    const res = await request(app).post('/api/auth/verify').send({ code: GUEST_CODE })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, role: 'guest' })
  })

  it('reports the role of the code in use', async () => {
    expect((await asGuest(request(app).get('/api/auth/session'))).body).toEqual({ role: 'guest' })
    expect((await asOwner(request(app).get('/api/auth/session'))).body).toEqual({ role: 'owner' })
  })

  it('reads the trip, the zones, the places and the schedule', async () => {
    for (const path of [
      '/api/trip',
      '/api/itinerary',
      '/api/zones/zone-tokyo',
      '/api/zones/zone-tokyo/places?category=food',
      '/api/places/place-ramen',
      '/api/shopping',
      '/api/reminders',
      '/api/search?q=ramen',
    ]) {
      const res = await asGuest(request(app).get(path))
      expect(res.status, path).toBe(200)
    }
  })
})

describe('guest is read-only', () => {
  const writes: [string, string, object][] = [
    ['post', '/api/places', { zone_id: 'zone-tokyo', category: 'food', name: 'New' }],
    ['patch', '/api/places/place-ramen', { name: 'Renamed' }],
    ['delete', '/api/places/place-ramen', {}],
    ['post', '/api/tips', { body: 'hello', zone_id: 'zone-tokyo' }],
    ['patch', '/api/tips/tip-zone', { body: 'edited' }],
    ['delete', '/api/tips/tip-zone', {}],
    ['post', '/api/shopping', { name: 'Thing', category: 'other' }],
    ['patch', '/api/shopping/buy-1', { bought: true }],
    ['delete', '/api/shopping/buy-1', {}],
    ['post', '/api/itinerary', { day: '2026-10-06', title: 'Something' }],
    ['patch', '/api/itinerary/itin-ramen', { title: 'Edited' }],
    ['delete', '/api/itinerary/itin-ramen', {}],
    [
      'post',
      '/api/steps',
      { zone_id: 'zone-tokyo', start_date: '2026-10-06', end_date: '2026-10-07' },
    ],
    ['patch', '/api/steps/step-1', { start_date: '2026-10-06' }],
    ['delete', '/api/steps/step-1', {}],
    ['post', '/api/reminders', { title: 'Book it', remind_at: '2026-09-01T10:00:00.000Z' }],
    ['post', '/api/push/subscriptions', { endpoint: 'https://example.com/x', keys: {} }],
  ]

  it.each(writes)('refuses %s %s', async (method, path, body) => {
    const call = (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](
      path
    )
    const res = await asGuest(call).send(body)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('leaves the data untouched after a refused delete', async () => {
    await asGuest(request(app).delete('/api/places/place-ramen'))
    const res = await asOwner(request(app).get('/api/places/place-ramen'))
    expect(res.status).toBe(200)
    expect(res.body.place.name).toBe('Ramen Bar')
  })
})

describe('guest sees no documents', () => {
  it('refuses every /api/files route', async () => {
    const paths = ['/api/files', '/api/files/file-trip/url', '/api/files/file-trip/content']
    for (const path of paths) {
      const res = await asGuest(request(app).get(path))
      expect(res.status, path).toBe(403)
      expect(res.body.error.code, path).toBe('FORBIDDEN')
    }
    const del = await asGuest(request(app).delete('/api/files/file-trip'))
    expect(del.status).toBe(403)
  })

  it('strips files attached to a place', async () => {
    const owner = await asOwner(request(app).get('/api/places/place-ramen'))
    expect(owner.body.files.length).toBeGreaterThan(0) // the fixture has one

    const guest = await asGuest(request(app).get('/api/places/place-ramen'))
    expect(guest.status).toBe(200)
    expect(guest.body.files).toEqual([])
    expect(guest.body.place.name).toBe('Ramen Bar') // everything else is still there
    expect(guest.body.tips.length).toBeGreaterThan(0)
  })

  it('strips files attached to a zone', async () => {
    const owner = await asOwner(request(app).get('/api/zones/zone-kyoto'))
    expect(owner.body.files.length).toBeGreaterThan(0)

    const guest = await asGuest(request(app).get('/api/zones/zone-kyoto'))
    expect(guest.status).toBe(200)
    expect(guest.body.files).toEqual([])
    expect(guest.body.zone.name).toBe('Kyoto')
  })
})

describe('the owner code is unaffected', () => {
  it('still writes and still sees documents', async () => {
    const patch = await asOwner(request(app).patch('/api/places/place-ramen')).send({
      name: 'Ramen Bar 2',
    })
    expect(patch.status).toBe(200)

    const files = await asOwner(request(app).get('/api/files'))
    expect(files.status).toBe(200)
    expect(files.body.files.length).toBeGreaterThan(0)
  })
})
