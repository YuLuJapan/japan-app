// The cross-tenant sweep.
//
// Rather than a hand-written list of routes — which stays accurate only as
// long as everyone remembers to update it — this walks the actual Express
// stack of the trip-scoped router. A route added under /api/trips/:tripId is
// therefore swept automatically, and a route that somehow escapes the guard
// fails here rather than in production.
//
// What this file does NOT yet prove: that a resource named later in the path
// belongs to the trip named earlier. `/trips/A/places/<place-in-B>` still
// resolves, because zones are not trip-scoped in the schema until phase 3b.
// Those cases are `it.todo` below, and 3b is the commit that turns them on.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { Router } from 'express'
import { createApp, tripScopedRouter } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { clearTokenCache } from '../src/lib/identity.js'
import { OUTSIDER_USER, OWNER_USER, PARTNER_USER, TEST_CODE, fixture } from './fixture.js'

const mocks = vi.hoisted(() => ({ resolveAuthUser: vi.fn() }))
vi.mock('../src/lib/supabaseAuth.js', () => ({ resolveAuthUser: mocks.resolveAuthUser }))

const TOKENS: Record<string, typeof OWNER_USER> = {
  'owner.jwt': OWNER_USER,
  'partner.jwt': PARTNER_USER,
  'outsider.jwt': OUTSIDER_USER,
}

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()

interface RouteEntry {
  method: string
  path: string
}

/** Walks an Express router (and any sub-routers) into a flat list of routes. */
function collectRoutes(router: Router, prefix = ''): RouteEntry[] {
  const out: RouteEntry[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const layer of (router as any).stack ?? []) {
    if (layer.route) {
      const path = prefix + layer.route.path
      for (const method of Object.keys(layer.route.methods)) {
        if (method !== '_all') out.push({ method: method.toUpperCase(), path })
      }
    } else if (layer.handle?.stack) {
      out.push(...collectRoutes(layer.handle as Router, prefix))
    }
  }
  return out
}

/** Real ids from the fixture, so nothing 404s merely for being made up. */
const REAL_IDS: Record<string, string> = {
  ':zoneId': 'zone-tokyo',
  ':placeId': 'place-hotel',
  ':tipId': 'tip-zone',
  ':itemId': 'itin-ramen',
  ':stepId': 'step-1',
  ':reminderId': 'reminder-1',
  ':fileId': 'file-trip',
}

const fill = (path: string) =>
  path
    .split('/')
    .map((seg) => REAL_IDS[seg] ?? seg)
    .join('/')

const ROUTES = collectRoutes(tripScopedRouter())

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  clearTokenCache()
  mocks.resolveAuthUser.mockReset()
  mocks.resolveAuthUser.mockImplementation(async (token: string) => TOKENS[token] ?? null)
})

const as = (token: string) => ({ Authorization: `Bearer ${token}` })

const url = (path: string) => `/api/trips/trip-1${fill(path)}`.replace(/\/$/, '')

describe('the sweep covers the whole trip-scoped surface', () => {
  it('found routes to sweep at all', () => {
    // Guards the guard: a refactor that stopped mounting sub-routers would
    // otherwise make every case below vacuously pass.
    expect(ROUTES.length).toBeGreaterThanOrEqual(20)
  })

  it('sweeps every HTTP verb the router registers', () => {
    const verbs = new Set(ROUTES.map((r) => r.method))
    expect([...verbs].sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST'])
  })
})

describe('a non-member is refused everywhere under /api/trips/:tripId', () => {
  it.each(ROUTES.map((r) => [r.method, r.path] as const))('%s %s → 404', async (method, path) => {
    const send = request(app)[method.toLowerCase() as 'get']
    const res = await send(url(path)).set('Authorization', 'Bearer outsider.jwt').send({})
    // 404, never 403: a 403 would confirm the trip exists to someone with no
    // business knowing that.
    expect(res.status).toBe(404)
  })
})

describe('a member is not refused', () => {
  // The other half of the sweep: a guard that refused everyone would pass the
  // block above while breaking the app.
  it.each(ROUTES.filter((r) => r.method === 'GET').map((r) => [r.path] as const))(
    'GET %s is reachable',
    async (path) => {
      const res = await request(app).get(url(path)).set('Authorization', 'Bearer owner.jwt')
      expect(res.status).not.toBe(404)
      expect(res.status).not.toBe(403)
    }
  )
})

describe('an unknown trip id is indistinguishable from someone else’s', () => {
  it('404s for a member of a different trip', async () => {
    await request(app)
      .get('/api/trips/trip-does-not-exist')
      .set('Authorization', 'Bearer owner.jwt')
      .expect(404)
  })

  it('404s for a brand-new account', async () => {
    await request(app)
      .get('/api/trips/trip-does-not-exist')
      .set('Authorization', 'Bearer outsider.jwt')
      .expect(404)
  })
})

describe('cross-resource scoping', () => {
  // These were `it.todo` from 3a-i until phase 3b: nesting proves you are a
  // member of the trip in the path, but not that the resource named after it
  // belongs to that trip. zones.trip_id and a trip id on every store method
  // are what closed the gap — so this is the block that had to turn on.
  //
  // The caller is a full owner of trip-1 throughout. Nothing here is about
  // authentication; it is about trip-1 being the wrong door for trip-2's rows.
  const owner = () => as('owner.jwt')

  it.each([
    ['a place', 'GET', '/places/place-other'],
    ['a zone', 'GET', '/zones/zone-osaka'],
    ["a zone's places", 'GET', '/zones/zone-osaka/places'],
    ['a tip', 'PATCH', '/tips/tip-other'],
    ['a step', 'PATCH', '/steps/step-other'],
  ])('404s %s from another trip addressed through mine', async (_what, method, path) => {
    const send = request(app)[method.toLowerCase() as 'get']
    const res = await send(`/api/trips/trip-1${path}`).set(owner()).send({ body: 'x' })
    expect(res.status).toBe(404)
  })

  it('404s deleting another trip’s place', async () => {
    await request(app).delete('/api/trips/trip-1/places/place-other').set(owner()).expect(404)
    // …and it is still there.
    await request(app)
      .get('/api/trips/trip-2/places/place-other')
      .set(as('partner.jwt'))
      .expect(200)
  })

  it('refuses to move a place into a zone belonging to another trip', async () => {
    const res = await request(app)
      .patch('/api/trips/trip-1/places/place-ramen')
      .set(owner())
      .send({ zone_id: 'zone-osaka' })
    expect(res.status).toBe(404)

    // The place kept its own zone rather than being half-moved.
    const after = await request(app).get('/api/trips/trip-1/places/place-ramen').set(owner())
    expect(after.body.place.zone_id).toBe('zone-tokyo')
  })

  it('refuses to hang a tip off another trip’s zone', async () => {
    const res = await request(app)
      .post('/api/trips/trip-1/tips')
      .set(owner())
      .send({ zone_id: 'zone-osaka', body: 'sneaky' })
    expect(res.status).toBe(404)
  })

  it('refuses to point a journey step at another trip’s zone', async () => {
    const res = await request(app)
      .post('/api/trips/trip-1/steps')
      .set(owner())
      .send({ zone_id: 'zone-osaka', start_date: '2026-10-02', end_date: '2026-10-03' })
    expect(res.status).toBe(404)
  })

  it('keeps each trip’s own resources reachable', async () => {
    // The other half: a guard that refused everything would pass all of the
    // above while breaking the app.
    await request(app).get('/api/trips/trip-1/places/place-ramen').set(owner()).expect(200)
    await request(app).get('/api/trips/trip-1/zones/zone-tokyo').set(owner()).expect(200)
    await request(app).get('/api/trips/trip-2/zones/zone-osaka').set(as('partner.jwt')).expect(200)
  })
})
