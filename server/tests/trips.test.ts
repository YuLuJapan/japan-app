import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { getDataStore, type DataStore } from '../src/lib/datastore.js'
import { VIEWER_USER } from '../testing/fixture.js'
import { OWNER_BEARER, asOutsider, asViewer } from './auth.js'

const app = createApp()
const auth = () => request(app).get('/api/trips').set(OWNER_BEARER)

let store: DataStore

beforeEach(async () => {
  store = await getDataStore()
})

/**
 * A second trip with two activities near its end and no journey stops, so a
 * date change can strand the activities alone (the seeded trip's stops always
 * cover its activity days, which is the point of the rule).
 */
async function tripWithActivities() {
  const created = await request(app)
    .post('/api/trips')
    .set(OWNER_BEARER)
    .send({ name: 'Lisbon', start_date: '2027-03-01', end_date: '2027-03-08' })
  const tripId = created.body.trip.id as string

  const itemIds: string[] = []
  for (const item of [
    { day: '2027-03-06', title: 'Tram 28', start_time: '09:00' },
    { day: '2027-03-07', title: 'Time Out Market' },
  ]) {
    const res = await request(app)
      .post(`/api/trips/${tripId}/itinerary`)
      .set(OWNER_BEARER)
      .send(item)
    itemIds.push(res.body.item.id)
  }
  return { tripId, itemIds }
}

describe('trips', () => {
  it('GET /api/trips lists the caller’s own trips, and only those', async () => {
    const res = await auth()
    expect(res.status).toBe(200)
    // The fixture holds a second trip belonging to another account. There is
    // no longer any credential that reaches both.
    expect(res.body.trips).toHaveLength(1)
    expect(res.body.trips[0]).toMatchObject({
      id: 'trip-1',
      name: 'Test Trip',
      people: [{ name: 'Alex' }, { name: 'Sam' }],
    })
  })

  it('GET /api/trips/:tripId returns the bundle for a trip you are on', async () => {
    const res = await request(app).get('/api/trips/trip-1').set(OWNER_BEARER)
    expect(res.status).toBe(200)
    expect(res.body.trip.id).toBe('trip-1')
  })

  it('POST /api/trips creates a second trip without disturbing the first', async () => {
    const create = await request(app)
      .post('/api/trips')
      .set(OWNER_BEARER)
      .send({
        name: 'Dolomites',
        start_date: '2027-02-06',
        end_date: '2027-02-14',
        // legacy plain-string travellers are still accepted and normalized
        people: ['Alex', ' Sam '],
      })
    expect(create.status).toBe(201)
    expect(create.body.trip).toMatchObject({
      name: 'Dolomites',
      people: [{ name: 'Alex' }, { name: 'Sam' }],
    })

    const list = await auth()
    expect(list.body.trips.map((t: { name: string }) => t.name)).toEqual(['Test Trip', 'Dolomites'])

    // the existing trip is unaffected by the new one
    const legacy = await request(app).get('/api/trips/trip-1').set(OWNER_BEARER)
    expect(legacy.body.trip.id).toBe('trip-1')
  })

  it('POST /api/trips takes the destination’s currency and what to convert it into', async () => {
    const create = await request(app)
      .post('/api/trips')
      .set(OWNER_BEARER)
      .send({
        name: 'Bangkok',
        start_date: '2027-02-06',
        end_date: '2027-02-14',
        local_currency: 'thb',
        home_currencies: ['usd', 'ILS', 'USD'],
      })
    expect(create.status).toBe(201)
    // uppercased and de-duplicated on the way in
    expect(create.body.trip).toMatchObject({
      local_currency: 'THB',
      home_currencies: ['USD', 'ILS'],
    })

    const patched = await request(app)
      .patch(`/api/trips/${create.body.trip.id}`)
      .set(OWNER_BEARER)
      .send({ home_currencies: ['EUR'] })
    expect(patched.status).toBe(200)
    expect(patched.body.trip.home_currencies).toEqual(['EUR'])
    expect(patched.body.trip.local_currency).toBe('THB')
  })

  it('a trip created without currencies keeps the calculator’s old pair', async () => {
    const create = await request(app)
      .post('/api/trips')
      .set(OWNER_BEARER)
      .send({ name: 'Anywhere', start_date: '2027-02-06', end_date: '2027-02-14' })
    expect(create.body.trip).toMatchObject({
      local_currency: 'JPY',
      home_currencies: ['USD', 'ILS'],
    })
  })

  it('POST /api/trips rejects currencies it could never quote', async () => {
    const send = (body: object) =>
      request(app)
        .post('/api/trips')
        .set(OWNER_BEARER)
        .send({ start_date: '2027-02-06', end_date: '2027-02-14', ...body })

    const bad = await send({ local_currency: 'XYZ' })
    expect(bad.status).toBe(400)
    expect(bad.body.error.details.join(' ')).toContain('local_currency')

    const empty = await send({ home_currencies: [] })
    expect(empty.status).toBe(400)
    expect(empty.body.error.details.join(' ')).toContain('at least one')

    const tooMany = await send({ home_currencies: ['USD', 'ILS', 'EUR', 'GBP'] })
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.error.details.join(' ')).toContain('at most 3')
  })

  it('POST /api/trips rejects end before start', async () => {
    const res = await request(app)
      .post('/api/trips')
      .set(OWNER_BEARER)
      .send({ name: '', start_date: '2027-02-14', end_date: '2027-02-06' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.stringContaining('end_date')])
    )
    // The name is no longer among them: it is an override, and an empty one
    // means "build the title from who is going and where".
    expect(res.body.error.details.join(' ')).not.toContain('name is required')
  })

  it('POST /api/trips names an unnamed trip from its travellers and country', async () => {
    const res = await request(app)
      .post('/api/trips')
      .set(OWNER_BEARER)
      .send({
        country: 'Italy',
        start_date: '2027-02-06',
        end_date: '2027-02-14',
        people: ['Alex', 'Sam'],
      })
    expect(res.status).toBe(201)
    expect(res.body.trip.name).toBeNull()
    expect(res.body.trip.display_title).toBe('Alex and Sam in Italy')
  })

  it('lets a title given later win over the built one', async () => {
    const created = await request(app)
      .post('/api/trips')
      .set(OWNER_BEARER)
      .send({ country: 'Italy', start_date: '2027-02-06', end_date: '2027-02-14' })
    // No travellers on the roster, so the title falls back to who is on the
    // trip — which, for a trip just created, is whoever created it.
    expect(created.body.trip.display_title).toBe('Yuval in Italy')

    const named = await request(app)
      .patch(`/api/trips/${created.body.trip.id}`)
      .set(OWNER_BEARER)
      .send({ name: 'Dolomites' })
    expect(named.body.trip.display_title).toBe('Dolomites')

    // …and clearing it goes back to the built one rather than storing "".
    const cleared = await request(app)
      .patch(`/api/trips/${created.body.trip.id}`)
      .set(OWNER_BEARER)
      .send({ name: '' })
    expect(cleared.body.trip.name).toBeNull()
    expect(cleared.body.trip.display_title).toBe('Yuval in Italy')
  })

  it('GET /api/trips/:tripId 404s for an unknown trip', async () => {
    const res = await request(app).get('/api/trips/nope').set(OWNER_BEARER)
    expect(res.status).toBe(404)
  })

  it('PATCH /api/trips/:tripId updates travellers (with an email) and dates', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set(OWNER_BEARER)
      .send({ people: [{ name: 'Alex' }, { name: 'Sam', email: 'sam@example.com' }, 'Noa'] })
    expect(res.status).toBe(200)
    expect(res.body.trip.people).toEqual([
      { name: 'Alex' },
      { name: 'Sam', email: 'sam@example.com' },
      { name: 'Noa' },
    ])
    expect(res.body.trip.start_date).toBe('2026-10-01') // untouched fields survive a partial patch
  })

  it('PATCH /api/trips/:tripId rejects an invalid traveller email', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set(OWNER_BEARER)
      .send({ people: [{ name: 'Alex', email: 'not-an-email' }] })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('PATCH /api/trips/:tripId refuses dates that would strand a stop, and changes nothing', async () => {
    // fixture: trip 2026-10-01→14, steps 10-05→09 and 10-09→12, activities on 10-06
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set(OWNER_BEARER)
      .send({ start_date: '2026-10-07', end_date: '2026-10-14' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(res.body.error.details.join(' ')).toMatch(/journey stop \(2026-10-05 – 2026-10-09\)/)

    const unchanged = await request(app).get('/api/trips/trip-1').set(OWNER_BEARER)
    expect(unchanged.body.trip.start_date).toBe('2026-10-01')
  })

  it('names the stranded activity days when only activities are in the way', async () => {
    const { tripId } = await tripWithActivities()
    const res = await request(app)
      .patch(`/api/trips/${tripId}`)
      .set(OWNER_BEARER)
      .send({ end_date: '2027-03-04' })
    expect(res.status).toBe(400)
    const details = res.body.error.details.join(' ')
    expect(details).toMatch(/2027-03-06/)
    expect(details).toMatch(/2027-03-07/)
  })

  it('GET /api/trips/:tripId/date-impact lists what a date change would strand', async () => {
    const res = await request(app)
      .get('/api/trips/trip-1/date-impact?start_date=2026-10-07&end_date=2026-10-14')
      .set(OWNER_BEARER)
    expect(res.status).toBe(200)
    expect(res.body.range).toEqual({ start_date: '2026-10-07', end_date: '2026-10-14' })
    // step-1 (10-05 → 10-09) starts before the new range; step-2 (10-09 → 10-12) fits
    expect(res.body.steps.map((s: { id: string }) => s.id)).toEqual(['step-1'])
    expect(res.body.steps[0].zone_name).toBe('Tokyo')
    // The dry run says where the stop would land, so the sheet can show the
    // real outcome instead of promising the stay survives intact.
    expect(res.body.steps[0].moves_to).toEqual({
      start_date: '2026-10-07',
      end_date: '2026-10-11', // Tokyo's 4 nights still fit
    })
    // both fixture activities sit on 2026-10-06
    expect(res.body.items.map((i: { id: string }) => i.id).sort()).toEqual([
      'itin-ramen',
      'itin-walk',
    ])
    expect(res.body.items[0]).toMatchObject({ day: '2026-10-06', title: expect.any(String) })
  })

  it('GET date-impact reports nothing for a range that still covers everything', async () => {
    const res = await request(app)
      .get('/api/trips/trip-1/date-impact?start_date=2026-10-01&end_date=2026-10-20')
      .set(OWNER_BEARER)
    expect(res.status).toBe(200)
    expect(res.body.steps).toEqual([])
    expect(res.body.items).toEqual([])
  })

  it('a stranded stop is still refused without a stop resolution', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set(OWNER_BEARER)
      .send({ start_date: '2026-10-07', end_date: '2026-10-14', stranded_activities: 'move' })
    expect(res.status).toBe(400)
    expect(res.body.error.details.join(' ')).toMatch(/journey stop/i)
  })

  it('stranded_stops=move brings the stops along, keeping their length', async () => {
    // step-1 Tokyo 10-05 → 10-09 (4 nights) is the one that falls outside.
    const res = await request(app).patch('/api/trips/trip-1').set(OWNER_BEARER).send({
      start_date: '2026-10-07',
      end_date: '2026-10-14',
      stranded_stops: 'move',
      stranded_activities: 'move',
    })
    expect(res.status).toBe(200)
    expect(res.body.moved_stops).toEqual(['step-1'])

    const trip = await request(app).get('/api/trips/trip-1').set(OWNER_BEARER)
    const moved = trip.body.steps.find((s: { id: string }) => s.id === 'step-1')
    expect(moved).toMatchObject({ start_date: '2026-10-07', end_date: '2026-10-11' }) // 4 nights kept
    // and nothing is left outside the trip
    for (const s of trip.body.steps) {
      expect(s.start_date >= '2026-10-07' && s.end_date <= '2026-10-14').toBe(true)
    }
  })

  it('reports the clipped landing spot up front for a stay the trip cannot hold', async () => {
    // step-1 Tokyo is 4 nights; the new trip is 2 days long.
    const res = await request(app)
      .get('/api/trips/trip-1/date-impact?start_date=2026-10-13&end_date=2026-10-14')
      .set(OWNER_BEARER)
    const tokyo = res.body.steps.find((s: { id: string }) => s.id === 'step-1')
    expect(tokyo.moves_to).toEqual({ start_date: '2026-10-13', end_date: '2026-10-14' })
  })

  it('clips a stop that no longer fits rather than letting it hang off the end', async () => {
    // A 4-night stop cannot survive intact on a 2-day trip.
    const res = await request(app).patch('/api/trips/trip-1').set(OWNER_BEARER).send({
      start_date: '2026-10-13',
      end_date: '2026-10-14',
      stranded_stops: 'move',
      stranded_activities: 'delete',
    })
    expect(res.status).toBe(200)
    const trip = await request(app).get('/api/trips/trip-1').set(OWNER_BEARER)
    for (const s of trip.body.steps) {
      expect(s).toMatchObject({ start_date: '2026-10-13', end_date: '2026-10-14' })
    }
  })

  it('lets a trip be postponed wholesale — the case that used to deadlock', async () => {
    // Nothing about the old window overlaps the new one: every stop and every
    // activity has to travel with it, which is impossible one entity at a time
    // (a stop cannot leave the trip's dates, and the dates cannot move first).
    const res = await request(app).patch('/api/trips/trip-1').set(OWNER_BEARER).send({
      start_date: '2027-01-10',
      end_date: '2027-01-24',
      stranded_stops: 'move',
      stranded_activities: 'move',
    })
    expect(res.status).toBe(200)
    expect(res.body.trip).toMatchObject({ start_date: '2027-01-10', end_date: '2027-01-24' })
    expect(res.body.moved_stops).toHaveLength(2)
    expect(res.body.moved).toHaveLength(2)

    const trip = await request(app).get('/api/trips/trip-1').set(OWNER_BEARER)
    // Tokyo kept its 4 nights, Kyoto its 3, both anchored on the new first day.
    expect(trip.body.steps.map((s: { start_date: string; end_date: string }) => s)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start_date: '2027-01-10', end_date: '2027-01-14' }),
        expect.objectContaining({ start_date: '2027-01-10', end_date: '2027-01-13' }),
      ])
    )
    const items = await request(app).get('/api/trips/trip-1/itinerary').set(OWNER_BEARER)
    for (const i of items.body.items) expect(i.day).toBe('2027-01-10')
  })

  it('rejects an unknown stranded_stops value', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set(OWNER_BEARER)
      .send({ start_date: '2026-10-01', end_date: '2026-10-14', stranded_stops: 'delete' })
    expect(res.status).toBe(400)
    expect(res.body.error.details.join(' ')).toMatch(/stranded_stops must be one of: move/)
  })

  it('PATCH with stranded_activities=move keeps the activities on the new first day', async () => {
    const { tripId, itemIds } = await tripWithActivities()

    const ok = await request(app)
      .patch(`/api/trips/${tripId}`)
      .set(OWNER_BEARER)
      .send({ start_date: '2027-03-01', end_date: '2027-03-04', stranded_activities: 'move' })
    expect(ok.status).toBe(200)
    expect(ok.body.trip.end_date).toBe('2027-03-04')
    expect(ok.body.moved.sort()).toEqual([...itemIds].sort())

    const items = await request(app).get(`/api/trips/${tripId}/itinerary`).set(OWNER_BEARER)
    expect(items.body.items).toHaveLength(2) // nothing lost
    for (const item of items.body.items) expect(item.day).toBe('2027-03-01')
    // the move touches the day and nothing else
    const timed = items.body.items.find((i: { id: string }) => i.id === itemIds[0])
    expect(timed).toMatchObject({ title: 'Tram 28', start_time: '09:00' })
  })

  it('PATCH with stranded_activities=delete drops them instead', async () => {
    const { tripId } = await tripWithActivities()

    const refused = await request(app)
      .patch(`/api/trips/${tripId}`)
      .set(OWNER_BEARER)
      .send({ start_date: '2027-03-01', end_date: '2027-03-04' })
    expect(refused.status).toBe(400) // still refused without a choice

    const ok = await request(app)
      .patch(`/api/trips/${tripId}`)
      .set(OWNER_BEARER)
      .send({ start_date: '2027-03-01', end_date: '2027-03-04', stranded_activities: 'delete' })
    expect(ok.status).toBe(200)
    expect(ok.body.deleted).toHaveLength(2)

    const items = await request(app).get(`/api/trips/${tripId}/itinerary`).set(OWNER_BEARER)
    expect(items.body.items).toEqual([])
  })

  it('PATCH rejects an unknown stranded_activities value', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set(OWNER_BEARER)
      .send({ start_date: '2026-10-01', end_date: '2026-10-14', stranded_activities: 'shred' })
    expect(res.status).toBe(400)
    expect(res.body.error.details.join(' ')).toMatch(/stranded_activities/)
  })

  it('a resolution is ignored when the new dates strand nothing', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set(OWNER_BEARER)
      .send({ end_date: '2026-10-20', stranded_activities: 'delete' })
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBeUndefined()
    const items = await request(app).get('/api/trips/trip-1/itinerary').set(OWNER_BEARER)
    expect(items.body.items).toHaveLength(2)
  })

  it('PATCH /api/trips/:tripId allows a date change that still covers everything planned', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1')
      .set(OWNER_BEARER)
      .send({ start_date: '2026-10-04', end_date: '2026-10-20' })
    expect(res.status).toBe(200)
    expect(res.body.trip).toMatchObject({ start_date: '2026-10-04', end_date: '2026-10-20' })
  })

  it('DELETE /api/trips/:tripId removes the trip and cascades its children', async () => {
    const del = await request(app).delete('/api/trips/trip-1').set(OWNER_BEARER)
    expect(del.status).toBe(204)

    const list = await auth()
    // Nothing of this account's is left; the other tenant's trip is untouched
    // (and was never visible here anyway).
    expect(list.body.trips).toEqual([])

    // children scoped to trip-1 (steps, itinerary, shopping) go with it
    const itinerary = await request(app).get('/api/trips/trip-1/itinerary').set(OWNER_BEARER)
    expect(itinerary.status).toBe(404) // the trip itself is gone
  })

  it('a viewer cannot create, update or delete — and an outsider sees nothing', async () => {
    // What replaced the guest code. A viewer is an ordinary signed-in account
    // that happens to be read-only *on this trip*: they may still create trips
    // of their own, which no shared code could express.
    await store.upsertTripMember({ trip_id: 'trip-1', user_id: VIEWER_USER.id, role: 'viewer' })

    const patch = await asViewer(request(app).patch('/api/trips/trip-1')).send({ name: 'Nope' })
    expect(patch.status).toBe(403)
    const del = await asViewer(request(app).delete('/api/trips/trip-1'))
    expect(del.status).toBe(403)

    const own = await asViewer(request(app).post('/api/trips')).send({
      name: 'Their own trip',
      start_date: '2027-01-01',
      end_date: '2027-01-02',
    })
    expect(own.status).toBe(201)

    // An account that is on no trip at all cannot see or touch this one.
    const outsider = await asOutsider(request(app).patch('/api/trips/trip-1')).send({ name: 'X' })
    expect(outsider.status).toBe(404)
  })
})
