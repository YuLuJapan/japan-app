// Zones were read-only: the photo migration 0001 seeded onto a city was the
// only one it could ever have. This is the first zone write, so as much of it
// is about the access rules the trip-scoped router gives for free as about the
// field itself.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { getDataStore, type DataStore } from '../src/lib/datastore.js'
import { PARTNER_USER, VIEWER_USER } from '../testing/fixture.js'
import { OWNER_BEARER, asOutsider, asPartner, asViewer } from './auth.js'

const app = createApp()
let store: DataStore

const PHOTO = 'https://upload.wikimedia.org/kyoto.jpg'

beforeEach(async () => {
  store = await getDataStore()
})

const patch = (body: object, zone = 'zone-tokyo') =>
  request(app).patch(`/api/trips/trip-1/zones/${zone}`).set(OWNER_BEARER).send(body)

const read = (zone = 'zone-tokyo') =>
  request(app).get(`/api/trips/trip-1/zones/${zone}`).set(OWNER_BEARER)

describe('setting a zone photo', () => {
  it('saves it and reads it back', async () => {
    const res = await patch({ image_url: PHOTO })
    expect(res.status).toBe(200)
    expect(res.body.zone.image_url).toBe(PHOTO)
    expect((await read()).body.zone.image_url).toBe(PHOTO)
  })

  it('clears it on null — the gradient beats a photo of the wrong place', async () => {
    await patch({ image_url: PHOTO })
    expect((await patch({ image_url: null })).status).toBe(200)
    expect((await read()).body.zone.image_url).toBeNull()
  })

  it('treats an empty string as clearing it, as the form sends', async () => {
    await patch({ image_url: PHOTO })
    await patch({ image_url: '' })
    expect((await read()).body.zone.image_url).toBeNull()
  })

  it('leaves the photo alone when the patch does not mention it', async () => {
    await patch({ image_url: PHOTO })
    await patch({})
    expect((await read()).body.zone.image_url).toBe(PHOTO)
  })

  it.each([
    ['a bare filename', 'kyoto.jpg'],
    ['a javascript: url', 'javascript:alert(1)'],
    ['a data: url', 'data:image/png;base64,AAA'],
    ['a number', 42],
  ])('refuses %s', async (_case, image_url) => {
    const res = await patch({ image_url })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })
})

describe('who may change one', () => {
  it('lets a partner change it — they can write on this trip', async () => {
    await store.upsertTripMember({
      trip_id: 'trip-1',
      user_id: PARTNER_USER.id,
      role: 'partner',
      can_see_stays: true,
      can_see_flight: true,
      can_see_documents: true,
      can_see_shopping: true,
    })
    const res = await asPartner(request(app).patch('/api/trips/trip-1/zones/zone-tokyo')).send({
      image_url: PHOTO,
    })
    expect(res.status).toBe(200)
  })

  it('refuses a viewer on the trip — 403, they already know it exists', async () => {
    await store.upsertTripMember({
      trip_id: 'trip-1',
      user_id: VIEWER_USER.id,
      role: 'viewer',
      can_see_stays: true,
      can_see_flight: true,
      can_see_documents: true,
      can_see_shopping: true,
    })
    const res = await asViewer(request(app).patch('/api/trips/trip-1/zones/zone-tokyo')).send({
      image_url: PHOTO,
    })
    expect(res.status).toBe(403)
  })

  it('hides the trip from an account that is not on it — 404, never 403', async () => {
    const res = await asOutsider(request(app).patch('/api/trips/trip-1/zones/zone-tokyo')).send({
      image_url: PHOTO,
    })
    expect(res.status).toBe(404)
  })

  it('will not reach across trips with a zone id from another one', async () => {
    // The store scopes the write by trip, so a zone that exists but belongs
    // elsewhere reads as no such zone rather than being quietly writable.
    const other = await store.createZone({ trip_id: 'trip-2', name: 'Elsewhere' })
    const res = await patch({ image_url: PHOTO }, other.id)
    expect(res.status).toBe(404)
    expect((await store.getZone('trip-2', other.id))?.image_url).toBeNull()
  })
})
