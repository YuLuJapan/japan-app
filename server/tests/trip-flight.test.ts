// Attaching a booking to a trip from the trip form.
//
// Until this existed the only flight in the database was the one migration
// 0017 seeded onto trip-japan: `flight` was jsonb the API could read and had no
// way to write. The shape was already right for connections — extra legs *are*
// the connection — so this is a write path, not a new schema.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { VIEWER_USER, fixture } from './fixture.js'
import { OWNER_BEARER, asViewer, useTestTokens } from './auth.js'

const app = createApp()
let store: DataStore

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
})

const patch = (body: object) => request(app).patch('/api/trips/trip-1').set(OWNER_BEARER).send(body)

const read = () => request(app).get('/api/trips/trip-1').set(OWNER_BEARER)

const outbound = {
  legs: [
    { flight_no: 'ET 419', from: 'TLV', to: 'ADD' },
    { flight_no: 'ET 672', from: 'ADD', to: 'NRT' },
  ],
}

describe('attaching a flight to a trip', () => {
  it('saves flight numbers and airports with no times at all', async () => {
    const res = await patch({ flight: { outbound } })
    expect(res.status).toBe(200)
    const bundle = await read()
    expect(bundle.body.flight.outbound.legs).toEqual(outbound.legs)
    expect(bundle.body.flight.outbound.depart_at).toBeUndefined()
  })

  it('keeps a connection as the extra legs it is, in order', async () => {
    await patch({ flight: { outbound } })
    const bundle = await read()
    expect(bundle.body.flight.outbound.legs.map((l: { to: string }) => l.to)).toEqual([
      'ADD',
      'NRT',
    ])
  })

  it('saves both directions', async () => {
    await patch({
      flight: {
        outbound,
        return_flight: { legs: [{ flight_no: 'ET 673', from: 'NRT', to: 'TLV' }] },
      },
    })
    const bundle = await read()
    expect(bundle.body.flight.return_flight.legs).toHaveLength(1)
  })

  it('keeps a time together with the zone it was written in', async () => {
    await patch({
      flight: {
        outbound: {
          ...outbound,
          depart_at: '2026-09-18T12:35:00.000Z',
          depart_tz: 'Asia/Jerusalem',
        },
      },
    })
    const bundle = await read()
    expect(bundle.body.flight.outbound).toMatchObject({
      depart_at: '2026-09-18T12:35:00.000Z',
      depart_tz: 'Asia/Jerusalem',
    })
  })

  it('leaves the booking alone when the patch does not mention it', async () => {
    // The trip sheet omits `flight` until it has read the real one, so that a
    // Save before the bundle lands cannot blank a booking nobody touched.
    await patch({ flight: { outbound } })
    await patch({ name: 'Renamed' })
    const bundle = await read()
    expect(bundle.body.flight.outbound.legs).toEqual(outbound.legs)
  })

  it('clears the booking on an explicit null', async () => {
    await patch({ flight: { outbound } })
    expect((await patch({ flight: null })).status).toBe(200)
    expect((await read()).body.flight).toBeUndefined()
  })

  it('reads a direction with no legs as no booking at all', async () => {
    const res = await patch({ flight: { outbound: { legs: [] } } })
    expect(res.status).toBe(200)
    expect((await read()).body.flight).toBeUndefined()
  })

  it('carries the flight through trip creation', async () => {
    const res = await request(app).post('/api/trips').set(OWNER_BEARER).send({
      name: 'Rome',
      start_date: '2027-04-01',
      end_date: '2027-04-08',
      flight: { outbound },
    })
    expect(res.status).toBe(201)
    const bundle = await request(app).get(`/api/trips/${res.body.trip.id}`).set(OWNER_BEARER)
    expect(bundle.body.flight.outbound.legs).toEqual(outbound.legs)
  })
})

describe('refusing a flight that would not read back', () => {
  it.each([
    ['a leg with no flight number', { outbound: { legs: [{ from: 'TLV', to: 'ADD' }] } }],
    ['a time with no zone', { outbound: { ...outbound, depart_at: '2026-09-18T12:35:00Z' } }],
    [
      'an unparseable time',
      { outbound: { ...outbound, depart_at: 'soon', depart_tz: 'Asia/Tokyo' } },
    ],
    [
      'a zone that is not a zone',
      { outbound: { ...outbound, depart_at: '2026-09-18T12:35:00Z', depart_tz: 'Mars/Olympus' } },
    ],
    ['a string where the booking belongs', 'ET 419'],
  ])('rejects %s', async (_case, flight: unknown) => {
    const res = await patch({ flight })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('refuses an unreasonable number of legs', async () => {
    const legs = Array.from({ length: 9 }, (_, i) => ({ flight_no: `ET ${i}`, from: 'A', to: 'B' }))
    const res = await patch({ flight: { outbound: { legs } } })
    expect(res.status).toBe(400)
  })
})

describe('who may attach one', () => {
  it('refuses a viewer on the trip — 403, because they know it exists', async () => {
    await store.upsertTripMember({
      trip_id: 'trip-1',
      user_id: VIEWER_USER.id,
      role: 'viewer',
      can_see_stays: true,
      can_see_flight: true,
      can_see_documents: true,
      can_see_shopping: true,
    })
    const res = await asViewer(request(app).patch('/api/trips/trip-1')).send({
      flight: { outbound },
    })
    expect(res.status).toBe(403)
  })

  it('hides the trip entirely from an account that is not on it — 404, not 403', async () => {
    const res = await asViewer(request(app).patch('/api/trips/trip-1')).send({
      flight: { outbound },
    })
    expect(res.status).toBe(404)
  })
})

describe('when the vacation itself begins', () => {
  it('saves a start time with the zone it was written in', async () => {
    const res = await patch({ start_time: '18:30', start_tz: 'Asia/Jerusalem' })
    expect(res.status).toBe(200)
    const bundle = await read()
    expect(bundle.body.trip.start_time).toBe('18:30')
    expect(bundle.body.trip.start_tz).toBe('Asia/Jerusalem')
  })

  it('clears it on null, back to no particular time', async () => {
    await patch({ start_time: '18:30', start_tz: 'Asia/Jerusalem' })
    await patch({ start_time: null, start_tz: null })
    expect((await read()).body.trip.start_time).toBeNull()
  })

  it('refuses a time with no zone — the countdown would move with the phone', async () => {
    const res = await patch({ start_time: '18:30' })
    expect(res.status).toBe(400)
    expect(res.body.error.details).toContain('start_time needs start_tz')
  })

  it.each([['half past six'], ['18:30:00'], ['25:00']])('refuses %s as a time', async (value) => {
    const res = await patch({ start_time: value, start_tz: 'Asia/Tokyo' })
    expect(res.status).toBe(400)
  })

  it('refuses a zone that is not a zone', async () => {
    const res = await patch({ start_time: '18:30', start_tz: 'Mars/Olympus' })
    expect(res.status).toBe(400)
  })

  it('leaves it alone when the patch does not mention it', async () => {
    await patch({ start_time: '18:30', start_tz: 'Asia/Jerusalem' })
    await patch({ name: 'Renamed' })
    expect((await read()).body.trip.start_time).toBe('18:30')
  })
})
