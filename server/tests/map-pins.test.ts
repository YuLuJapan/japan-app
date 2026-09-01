// FR-016, asserted on the wire rather than on the screen.
//
// The map's zone sweep asks for *every* category, which is the one shape where
// a stay could ride along unnoticed: the hotel chip is hidden for a member
// whose view withholds stays, but a chip is courtesy — what matters is that no
// hotel object is ever sent to that device (spec → "A hidden stay's pin").
//
// **This test passes the moment it is written**, and that is the point of it.
// `listZonePlaces` already filters stays before the response is built (research
// R1), so nothing here drives new behaviour. It locks in behaviour a later
// refactor could quietly remove — including the one in the same slice, which
// moves the response literal into `zonePlaceListItem`.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { VIEWER_USER, fixture } from './fixture.js'
import { useTestTokens } from './auth.js'

const app = createApp()

let store: DataStore

const owner = { Authorization: 'Bearer owner.jwt' }
const viewer = { Authorization: 'Bearer viewer.jwt' }
const outsider = { Authorization: 'Bearer outsider.jwt' }

/** The friend, on trip-1, read-only, with stays shown or withheld. */
const asViewer = (stays: boolean) =>
  store.upsertTripMember({
    trip_id: 'trip-1',
    user_id: VIEWER_USER.id,
    role: 'viewer',
    can_see_stays: stays,
    can_see_flight: true,
    can_see_documents: true,
    can_see_shopping: true,
  })

/** What the map asks for: one zone, no category, every place in it. */
const sweep = (headers: Record<string, string>) =>
  request(app).get('/api/trips/trip-1/activities').set(headers)

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
})

describe('the one list the map plots', () => {
  type Row = Record<string, unknown> & { zone_id: string; day: string | null }
  const inTokyo = (rows: Row[]) => rows.filter((a) => a.zone_id === 'zone-tokyo')

  it('gives an owner every activity in the city, stays and scheduled ones included', async () => {
    const res = await sweep(owner).expect(200)
    const tokyo = inTokyo(res.body.activities)
    expect(tokyo.map((p) => p.category)).toContain('hotel')
    expect(tokyo.map((p) => p.id).sort()).toEqual([
      'itin-ramen',
      'itin-walk',
      'place-hotel',
      'place-ramen',
    ])
    // The point of 010 for the map: a *scheduled* activity is plottable too.
    expect(tokyo.some((a) => a.day !== null)).toBe(true)
  })

  it('sends a viewer who may not see stays no hotel object at all', async () => {
    await asViewer(false)
    const res = await sweep(viewer).expect(200)
    // Not hidden, not redacted, not filtered later — absent from the payload.
    const saved = res.body.activities.filter((a: { day: string | null }) => !a.day)
    expect(saved.some((p: { category: string }) => p.category === 'hotel')).toBe(false)
    expect(inTokyo(saved).map((p) => p.id)).toEqual(['place-ramen'])
    // And the name never rides along in some other field either (SC-003).
    expect(JSON.stringify(res.body)).not.toContain('Test Hotel')
  })

  it('gives that same viewer the stays back once their view allows it', async () => {
    await asViewer(true)
    const res = await sweep(viewer).expect(200)
    expect(res.body.activities.some((p: { category: string }) => p.category === 'hotel')).toBe(true)
  })

  it('answers 404 to a non-member, indistinguishable from no such trip (FR-018)', async () => {
    await sweep(outsider).expect(404)
  })
})

describe('what a pin is built from', () => {
  it('returns lat and lng as null rather than omitting them', async () => {
    // The client counts the ones without a location (FR-019), and an absent key
    // and a null value are not equally easy to count honestly (contracts §1).
    const res = await sweep(owner).expect(200)
    const ramen = res.body.activities.find((p: { id: string }) => p.id === 'place-ramen')
    expect(ramen).toHaveProperty('lat', null)
    expect(ramen).toHaveProperty('lng', null)
  })

  it('carries a located activity through with its coordinates intact', async () => {
    const res = await sweep(owner).expect(200)
    const inari = res.body.activities.find((p: { id: string }) => p.id === 'place-everything')
    expect(inari.lat).toBe(34.9671)
    expect(inari.lng).toBe(135.7727)
  })

  it('emits exactly the fields the list policy admits, and no others', async () => {
    // The weaker, runtime half of the guard in `activityView`: the compile-time
    // half is `Record<keyof Activity, …>`, which `npm test` cannot see because
    // Vitest transpiles types away. This one catches a stray spread; typecheck
    // catches a new column nobody classified.
    //
    // `trip_id` is the one column deliberately absent — the caller asked for
    // this trip. Everything else travels; what keeps a stay's booking away
    // from someone who may not see it is `stripStay`, applied before this
    // projection, not the shape of the projection (see activity-view.ts).
    const res = await sweep(owner).expect(200)
    expect(Object.keys(res.body.activities[0]).sort()).toEqual([
      'address',
      'category',
      'day',
      'description',
      'file_count',
      'highlight',
      'icon',
      'id',
      'image_url',
      'lat',
      'links',
      'lng',
      'name',
      'name_ja',
      'position',
      'start_time',
      'summary_line',
      'zone_id',
    ])
  })
})
