import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { fixture } from './fixture.js'
import { asOwner as auth, useTestTokens } from './auth.js'

const app = createApp()

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  useTestTokens()
})

describe('activities', () => {
  it('GET /api/activities returns the whole trip: scheduled first, then saved', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/activities'))
    expect(res.status).toBe(200)
    const rows = res.body.activities as { id: string; day: string | null }[]
    // The scheduled half, in day order — 20:00 before "anytime".
    expect(rows.filter((a) => a.day).map((a) => a.id)).toEqual([
      'itin-ramen',
      'itin-walk',
      'itin-ryokan',
    ])
    // Then the saved half, which is what a city's Explore list renders. One
    // list, two orders — a screen filters it and never re-sorts (FR-010/011).
    expect(
      rows
        .filter((a) => !a.day)
        .map((a) => a.id)
        .sort()
    ).toEqual(['place-everything', 'place-hotel', 'place-ramen', 'place-ryokan'])
    // and the boundary is the date, nothing else
    const days = rows.map((a) => a.day)
    expect(days.indexOf(null)).toBe(days.filter((d) => d !== null).length)
  })

  // Before 010 the plan carried two derived tags — the linked place's category
  // and the names of files on it. There is no link now: the activity *is* the
  // place, so its own category is the tag and its own documents are counted.
  it('carries its own tag and a count of its own documents', async () => {
    const res = await auth(request(app).get('/api/trips/trip-1/activities'))
    const byId = Object.fromEntries(
      res.body.activities.map((i: { id: string }) => [i.id, i as Record<string, unknown>])
    )

    expect(byId['itin-ramen'].category).toBe('food')
    expect(byId['itin-walk'].category).toBeNull() // untagged is the ordinary case
    // A count, not the names: a document's name is a document (FR-021's rule
    // applied to the list), and the names are on the activity's own screen.
    expect(byId['place-ramen'].file_count).toBe(1)
    expect(byId['itin-walk'].file_count).toBe(0)
  })

  // A write answers with the row its list renders, and `file_count` is part of
  // that row. It used to default to zero on every single-activity response, so
  // the client merged a `0` back into the day plan and the 📎 came off an
  // activity that still had its documents — until something refetched.
  it('answers an edit with the documents the activity actually has', async () => {
    const before = await auth(request(app).get('/api/trips/trip-1/activities/place-ramen'))
    expect(before.body.activity.file_count).toBe(1)

    const patched = await auth(request(app).patch('/api/trips/trip-1/activities/place-ramen')).send(
      { start_time: '19:30' }
    )
    expect(patched.status).toBe(200)
    expect(patched.body.activity.file_count).toBe(1)

    // and the list it goes back into agrees, which is the whole point
    const list = await auth(request(app).get('/api/trips/trip-1/activities'))
    const row = list.body.activities.find((a: { id: string }) => a.id === 'place-ramen')
    expect(row.file_count).toBe(1)
  })

  it('accepts a saved activity with no date, and puts it in the saved half', async () => {
    const created = await auth(request(app).post('/api/trips/trip-1/activities')).send({
      zone_id: 'zone-tokyo',
      name: 'A shop to find',
      category: 'shopping',
    })
    expect(created.status).toBe(201)
    expect(created.body.activity.day).toBeNull()

    const res = await auth(request(app).get('/api/trips/trip-1/activities'))
    const mine = res.body.activities.find((i: { name: string }) => i.name === 'A shop to find')
    expect(mine.day).toBeNull()
    expect(mine.category).toBe('shopping')
  })

  it('refuses a saved activity with no city — Explore would have nowhere to put it', async () => {
    // FR-004. A service rule rather than a constraint: as a constraint it would
    // abort trip deletion (migration.md §2).
    const res = await auth(request(app).post('/api/trips/trip-1/activities')).send({
      name: 'Homeless',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.details.join(' ')).toMatch(/needs a city/)
  })

  it('schedules and un-schedules with one PATCH, which is the whole model', async () => {
    const created = await auth(request(app).post('/api/trips/trip-1/activities')).send({
      zone_id: 'zone-tokyo',
      name: 'Ramen again',
      category: 'food',
    })
    const id = created.body.activity.id

    const scheduled = await auth(request(app).patch(`/api/trips/trip-1/activities/${id}`)).send({
      day: '2026-10-06',
      start_time: '12:00',
    })
    expect(scheduled.status).toBe(200)
    expect(scheduled.body.activity.day).toBe('2026-10-06')

    const back = await auth(request(app).patch(`/api/trips/trip-1/activities/${id}`)).send({
      day: null,
    })
    expect(back.status).toBe(200)
    expect(back.body.activity.day).toBeNull()
  })

  it('POST /api/activities creates an item and it appears in the list', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/activities')).send({
      zone_id: 'zone-kyoto',
      day: '2026-10-10',
      start_time: '09:30',
      name: 'Fushimi Inari',
    })
    expect(res.status).toBe(201)
    expect(res.body.activity.id).toBeTruthy()
    // The trip is derived from the path, never echoed: `trip_id` is classified
    // 'omit' because the caller asked for this trip. That it was *derived* is
    // asserted by the isolation test below, which is where it can be seen.

    const list = await auth(request(app).get('/api/trips/trip-1/activities'))
    expect(list.body.activities.map((i: { name: string }) => i.name)).toContain('Fushimi Inari')
  })

  it('POST 400 on missing name, bad day, and bad time', async () => {
    const bad = await auth(request(app).post('/api/trips/trip-1/activities')).send({
      name: '  ',
      day: '10/10/2026',
      start_time: '25:00',
    })
    expect(bad.status).toBe(400)
    const details = bad.body.error.details.join(' ')
    expect(details).toMatch(/name is required/)
    expect(details).toMatch(/day must be an ISO date/)
    expect(details).toMatch(/start_time must be HH:MM/)
  })

  it("POST 400 when the day falls outside the trip's own dates", async () => {
    // fixture trip-1 runs 2026-10-01 → 2026-10-14
    for (const day of ['2026-09-30', '2026-10-15']) {
      const res = await auth(request(app).post('/api/trips/trip-1/activities')).send({
        day,
        name: 'Too early',
      })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION')
      expect(res.body.error.details.join(' ')).toMatch(/day must fall within the trip's dates/)
    }
  })

  it("POST accepts the trip's first and last day", async () => {
    for (const day of ['2026-10-01', '2026-10-14']) {
      const res = await auth(request(app).post('/api/trips/trip-1/activities')).send({
        day,
        name: 'Edge day',
      })
      expect(res.status).toBe(201)
    }
  })

  it('POST /api/trips/:tripId/activities validates against that trip, not the default one', async () => {
    const created = await auth(request(app).post('/api/trips')).send({
      name: 'Lisbon',
      start_date: '2027-03-01',
      end_date: '2027-03-08',
    })
    const tripId = created.body.trip.id

    const inRange = await auth(request(app).post(`/api/trips/${tripId}/activities`)).send({
      day: '2027-03-04',
      name: 'Pastéis de Belém',
    })
    expect(inRange.status).toBe(201)

    const outOfRange = await auth(request(app).post(`/api/trips/${tripId}/activities`)).send({
      day: '2026-10-06', // inside the *other* trip's dates
      name: 'Wrong trip',
    })
    expect(outOfRange.status).toBe(400)
    expect(outOfRange.body.error.code).toBe('VALIDATION')
  })

  it("PATCH 400 when the new day falls outside the trip's dates; 404 for an unknown item", async () => {
    const res = await auth(request(app).patch('/api/trips/trip-1/activities/itin-ramen')).send({
      day: '2026-10-20',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')

    const moved = await auth(request(app).patch('/api/trips/trip-1/activities/itin-ramen')).send({
      day: '2026-10-07',
    })
    expect(moved.status).toBe(200)
    expect(moved.body.activity.day).toBe('2026-10-07')

    const gone = await auth(request(app).patch('/api/trips/trip-1/activities/itin-nope')).send({
      day: '2026-10-07',
    })
    expect(gone.status).toBe(404)
  })

  it('POST 404 for an unknown zone', async () => {
    const res = await auth(request(app).post('/api/trips/trip-1/activities')).send({
      zone_id: 'zone-nope',
      day: '2026-10-10',
      name: 'Ghost stop',
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/trips/trip-1/activities/:id updates fields; clearing the time is allowed', async () => {
    const res = await auth(request(app).patch('/api/trips/trip-1/activities/itin-ramen')).send({
      name: 'Late-night ramen',
      start_time: '',
    })
    expect(res.status).toBe(200)
    expect(res.body.activity.name).toBe('Late-night ramen')
    expect(res.body.activity.start_time).toBeNull()
  })

  it('DELETE /api/trips/trip-1/activities/:id removes it; 404 when unknown', async () => {
    expect((await auth(request(app).delete('/api/trips/trip-1/activities/itin-walk'))).status).toBe(
      204
    )
    expect((await auth(request(app).delete('/api/trips/trip-1/activities/itin-walk'))).status).toBe(
      404
    )
  })

  // Before 010 this asserted that deleting a place left its plan entries behind
  // with `place_id` nulled. There is no link to null now, and no second row to
  // outlive the first: deleting an activity deletes exactly that activity, and
  // the ones that merely share a name are untouched.
  it('deletes only the activity asked for', async () => {
    const del = await auth(request(app).delete('/api/trips/trip-1/activities/place-ramen'))
    expect(del.status).toBe(204)

    const list = await auth(request(app).get('/api/trips/trip-1/activities'))
    const ids = list.body.activities.map((i: { id: string }) => i.id)
    expect(ids).not.toContain('place-ramen')
    expect(ids).toContain('itin-ramen') // the plan line of the same name stays
  })
})

describe('trip-scoped activity routes', () => {
  it('GET/POST /api/trips/:tripId/activities are isolated from the legacy default trip', async () => {
    const trip2 = await auth(request(app).post('/api/trips')).send({
      name: 'Dolomites',
      start_date: '2027-02-06',
      end_date: '2027-02-14',
    })
    const tripId = trip2.body.trip.id

    const created = await auth(request(app).post(`/api/trips/${tripId}/activities`)).send({
      day: '2027-02-07',
      name: 'Rifugio hike',
    })
    expect(created.status).toBe(201)

    const trip2List = await auth(request(app).get(`/api/trips/${tripId}/activities`))
    expect(trip2List.body.activities.map((i: { name: string }) => i.name)).toEqual(['Rifugio hike'])

    // trip-1's list is untouched, and doesn't see trip-2's item
    const trip1List = await auth(request(app).get('/api/trips/trip-1/activities'))
    expect(trip1List.body.activities.map((i: { id: string }) => i.id)).not.toContain('Rifugio hike')
    expect(
      trip1List.body.activities
        .filter((i: { day: string | null }) => i.day)
        .map((i: { id: string }) => i.id)
    ).toEqual(['itin-ramen', 'itin-walk', 'itin-ryokan'])
  })

  it('404s for an unknown trip', async () => {
    const res = await auth(request(app).get('/api/trips/nope/activities'))
    expect(res.status).toBe(404)
  })

  // The tag a traveller types on the activity, as opposed to place_category,
  // which is derived from a linked place and never stored.
  describe('the activity tag', () => {
    it('saves one of the five, and clears it again', async () => {
      const created = await auth(request(app).post('/api/trips/trip-1/activities')).send({
        day: '2026-10-05',
        name: 'Whatever the konbini has',
        category: 'food',
      })
      expect(created.status).toBe(201)
      expect(created.body.activity.category).toBe('food')

      const cleared = await auth(
        request(app).patch(`/api/trips/trip-1/activities/${created.body.activity.id}`)
      ).send({ category: null })
      expect(cleared.status).toBe(200)
      expect(cleared.body.activity.category).toBeNull()
    })

    it('defaults to none, and says so on the list', async () => {
      const res = await auth(request(app).get('/api/trips/trip-1/activities'))
      const walk = res.body.activities.find((i: { id: string }) => i.id === 'itin-walk')
      expect(walk.category).toBeNull()
    })

    // `other` used to be refused on a dated row, which made "More" an option
    // the form offered and the API rejected. It renders as "More" on the day
    // plan just as it does in Explore, so the date decides nothing here.
    it('takes `other` on a scheduled activity too', async () => {
      const res = await auth(request(app).post('/api/trips/trip-1/activities')).send({
        day: '2026-10-05',
        name: 'Coin laundry',
        category: 'other',
      })
      expect(res.status).toBe(201)
      expect(res.body.activity.category).toBe('other')
    })

    it('refuses a category that is not one of the five', async () => {
      const res = await auth(request(app).post('/api/trips/trip-1/activities')).send({
        day: '2026-10-05',
        name: 'Something',
        category: 'nonsense',
      })
      expect(res.status).toBe(400)
      expect(res.body.error.details.join(' ')).toMatch(/category must be one of/)
    })

    it('takes `other` on a PATCH that schedules a saved activity', async () => {
      const saved = await auth(request(app).post('/api/trips/trip-1/activities')).send({
        zone_id: 'zone-tokyo',
        name: 'Laundromat near the hotel',
        category: 'other',
      })
      expect(saved.status).toBe(201)
      const scheduled = await auth(
        request(app).patch(`/api/trips/trip-1/activities/${saved.body.activity.id}`)
      ).send({ day: '2026-10-05' })
      expect(scheduled.status).toBe(200)
      expect(scheduled.body.activity.category).toBe('other')
    })
  })
})
