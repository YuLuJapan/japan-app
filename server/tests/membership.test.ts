// Open registration, and what stops it leaking.
//
// This file replaces owner-auth.test.ts, which pinned down the TRIP_OWNER_EMAILS
// allow-list. That allow-list was the only thing making this a two-person app:
// it answered "is this email one of the travellers?" at the door. The question
// is now "is this account a member of this trip?", asked per trip — so anyone
// may register, and sees nothing until they create a trip or are invited.
//
// The cases below are therefore mostly about the *absence* of access: a
// perfectly valid account that is a member of nothing must be able to sign in
// and still reach none of somebody else's trip.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { clearTokenCache } from '../src/lib/identity.js'
import { OUTSIDER_USER, OWNER_USER, TEST_CODE, fixture } from './fixture.js'

const mocks = vi.hoisted(() => ({ resolveAuthUser: vi.fn() }))
vi.mock('../src/lib/supabaseAuth.js', () => ({ resolveAuthUser: mocks.resolveAuthUser }))

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()

/** Bearer tokens are per-user strings the mocked verifier maps back to accounts. */
const TOKENS: Record<string, typeof OWNER_USER> = {
  'owner.jwt': OWNER_USER,
  'outsider.jwt': OUTSIDER_USER,
}

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  clearTokenCache()
  mocks.resolveAuthUser.mockReset()
  mocks.resolveAuthUser.mockImplementation(async (token: string) => TOKENS[token] ?? null)
})

const as = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('anyone can register', () => {
  it('lets an account with no memberships sign in', async () => {
    const res = await request(app).get('/api/me').set(as('outsider.jwt'))
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('outsider@example.com')
  })

  it('shows a new account an empty trips list, not everybody else’s', async () => {
    const res = await request(app).get('/api/trips').set(as('outsider.jwt'))
    expect(res.status).toBe(200)
    expect(res.body.trips).toEqual([])
  })

  it('shows a member only their own trips', async () => {
    const res = await request(app).get('/api/trips').set(as('owner.jwt'))
    expect(res.status).toBe(200)
    expect(res.body.trips.map((t: { id: string }) => t.id)).toEqual(['trip-1'])
  })

  it('makes the creator an owner, so a new trip is never member-less', async () => {
    const created = await request(app)
      .post('/api/trips')
      .set(as('outsider.jwt'))
      .send({ name: 'Solo trip', start_date: '2027-01-01', end_date: '2027-01-10' })
    expect(created.status).toBe(201)
    expect(created.body.my_role).toBe('owner')

    const mine = await request(app).get('/api/trips').set(as('outsider.jwt'))
    expect(mine.body.trips.map((t: { name: string }) => t.name)).toEqual(['Solo trip'])
  })

  it('reports the caller’s role on the trip bundle', async () => {
    const res = await request(app).get('/api/trips/trip-1').set(as('owner.jwt'))
    expect(res.status).toBe(200)
    expect(res.body.my_role).toBe('owner')
  })
})

describe('a non-member reaches nothing', () => {
  it('404s the trip bundle rather than 403 — a 403 would confirm it exists', async () => {
    const res = await request(app).get('/api/trips/trip-1').set(as('outsider.jwt'))
    expect(res.status).toBe(404)
  })

  it('404s trip writes and deletes', async () => {
    await request(app).patch('/api/trips/trip-1').set(as('outsider.jwt')).send({ name: 'x' }).expect(404)
    await request(app).delete('/api/trips/trip-1').set(as('outsider.jwt')).expect(404)
  })

  // The legacy singleton routes are the sharp edge: they carry no trip id and
  // used to resolve to "the oldest trip in the database", which the moment
  // anyone can register means "the first trip anyone ever made".
  it.each([
    ['/api/trip'],
    ['/api/itinerary'],
    ['/api/shopping'],
    ['/api/reminders'],
    ['/api/files'],
  ])('404s the legacy singleton route %s', async (path) => {
    const res = await request(app).get(path).set(as('outsider.jwt'))
    expect(res.status).toBe(404)
  })

  // Zone ids are human-readable seed values, so this is a guess away, and a
  // stay's description *is* the accommodation booking.
  it('404s a guessable zone id', async () => {
    await request(app).get('/api/zones/zone-tokyo').set(as('outsider.jwt')).expect(404)
  })

  it('404s that zone’s places, including the stays', async () => {
    await request(app)
      .get('/api/zones/zone-tokyo/places?category=hotel')
      .set(as('outsider.jwt'))
      .expect(404)
  })

  it('404s a place in a zone that is not theirs', async () => {
    await request(app).get('/api/places/place-hotel').set(as('outsider.jwt')).expect(404)
  })

  it('refuses to create a place in someone else’s zone', async () => {
    await request(app)
      .post('/api/places')
      .set(as('outsider.jwt'))
      .send({ zone_id: 'zone-tokyo', category: 'food', name: 'Sneaky' })
      .expect(404)
  })

  it('lets the member through the same doors', async () => {
    await request(app).get('/api/trips/trip-1').set(as('owner.jwt')).expect(200)
    await request(app).get('/api/zones/zone-tokyo').set(as('owner.jwt')).expect(200)
    await request(app).get('/api/places/place-hotel').set(as('owner.jwt')).expect(200)
    await request(app).get('/api/trip').set(as('owner.jwt')).expect(200)
  })
})

describe('the deprecated access codes are unaffected', () => {
  // The whole point of resolving legacy codes to "every trip" is that this
  // change is invisible to the existing deployment.
  it('still sees every trip and every zone', async () => {
    const trips = await request(app).get('/api/trips').set(as(TEST_CODE))
    expect(trips.status).toBe(200)
    expect(trips.body.trips).toHaveLength(1)
    await request(app).get('/api/zones/zone-tokyo').set(as(TEST_CODE)).expect(200)
    await request(app).get('/api/trip').set(as(TEST_CODE)).expect(200)
  })

  it('never calls Supabase for a static code (fast path)', async () => {
    await request(app).get('/api/trip').set(as(TEST_CODE)).expect(200)
    expect(mocks.resolveAuthUser).not.toHaveBeenCalled()
  })

  it('rejects a token that verifies to nothing', async () => {
    await request(app).get('/api/trip').set(as('garbage')).expect(401)
  })
})
