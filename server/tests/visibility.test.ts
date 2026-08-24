// What a viewer is shown, flag by flag.
//
// Role decides which *verbs*; these flags decide which *content*. The
// route guard does not cover any of this — a viewer is a member, so they are
// allowed through it. What is asserted here is the layer underneath.
//
// Written as a matrix over the enforcement points rather than as prose cases,
// because the failure mode is a path someone forgot, not a rule someone got
// wrong.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { getDataStore, type DataStore } from '../src/lib/datastore.js'
import { OWNER_USER, VIEWER_USER } from '../testing/fixture.js'
import { tokenFor } from './auth.js'

const app = createApp()

let store: DataStore

interface Flags {
  stays?: boolean
  flight?: boolean
  documents?: boolean
  shopping?: boolean
}

/** Puts the friend on trip-1 as a viewer with the given visibility. */
async function asViewer({
  stays = true,
  flight = true,
  documents = false,
  shopping = true,
}: Flags = {}) {
  await store.upsertTripMember({
    trip_id: 'trip-1',
    user_id: VIEWER_USER.id,
    role: 'viewer',
    can_see_stays: stays,
    can_see_flight: flight,
    can_see_documents: documents,
    can_see_shopping: shopping,
  })
}

const viewer = { Authorization: `Bearer ${tokenFor(VIEWER_USER)}` }
const owner = { Authorization: `Bearer ${tokenFor(OWNER_USER)}` }

beforeEach(async () => {
  store = await getDataStore()
})

describe('stays', () => {
  it('hides the stay itself, its category count and its search hit', async () => {
    await asViewer({ stays: false })

    await request(app).get('/api/trips/trip-1/places/place-hotel').set(viewer).expect(403)

    const zone = await request(app).get('/api/trips/trip-1/zones/zone-tokyo').set(viewer)
    expect(zone.body.place_counts.hotel).toBe(0)

    const list = await request(app)
      .get('/api/trips/trip-1/zones/zone-tokyo/places?category=hotel')
      .set(viewer)
    expect(list.body.places).toEqual([])

    const search = await request(app).get('/api/trips/trip-1/search?q=Hotel').set(viewer)
    expect(search.body.results).toEqual([])
  })

  it('drops the stay from the all-categories sweep the city map uses', async () => {
    await asViewer({ stays: false })
    const res = await request(app)
      .get('/api/trips/trip-1/zones/zone-tokyo/places?category=')
      .set(viewer)
    expect(res.body.places.map((p: { id: string }) => p.id)).not.toContain('place-hotel')
    expect(res.body.places.map((p: { id: string }) => p.id)).toContain('place-ramen')
  })

  it('shows all of it when the flag is on', async () => {
    await asViewer({ stays: true })
    await request(app).get('/api/trips/trip-1/places/place-hotel').set(viewer).expect(200)
    const zone = await request(app).get('/api/trips/trip-1/zones/zone-tokyo').set(viewer)
    expect(zone.body.place_counts.hotel).toBe(1)
  })
})

describe('flight', () => {
  it('omits the block entirely rather than nulling it', async () => {
    await asViewer({ flight: false })
    const res = await request(app).get('/api/trips/trip-1').set(viewer)
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('flight')
  })

  it('includes it when the flag is on', async () => {
    await asViewer({ flight: true })
    const res = await request(app).get('/api/trips/trip-1').set(viewer)
    expect(res.body.flight).toBeTruthy()
  })
})

describe('documents', () => {
  it('empties the list and refuses the bytes when off', async () => {
    await asViewer({ documents: false })
    const list = await request(app).get('/api/trips/trip-1/files').set(viewer)
    expect(list.body.files).toEqual([])
    await request(app).get('/api/trips/trip-1/files/file-trip/content').set(viewer).expect(403)
    await request(app).get('/api/trips/trip-1/files/file-trip/url').set(viewer).expect(403)
  })

  it('serves them when on', async () => {
    await asViewer({ documents: true })
    const list = await request(app).get('/api/trips/trip-1/files').set(viewer)
    expect(list.body.files.length).toBeGreaterThan(0)
    await request(app).get('/api/trips/trip-1/files/file-trip/content').set(viewer).expect(200)
  })
})

describe('shopping', () => {
  // The whole section rather than a filtered version of it: an item on the
  // list *is* the thing being kept quiet, so there is nothing partial to
  // serve. Every route under /shopping refuses, not just the list.
  it('refuses the section when off', async () => {
    await asViewer({ shopping: false })
    const res = await request(app).get('/api/trips/trip-1/shopping').set(viewer)
    expect(res.status).toBe(403)
    // The refusal is the section guard's, not the read-only one a viewer
    // meets on any write — the list is a GET they would otherwise be served.
    expect(res.body.error.message).toMatch(/shopping list/i)
  })

  it('serves it when on', async () => {
    await asViewer({ shopping: true })
    const res = await request(app).get('/api/trips/trip-1/shopping').set(viewer)
    expect(res.status).toBe(200)
    expect(res.body.items.length).toBeGreaterThan(0)
  })

  it('says so on the trip bundle either way', async () => {
    await asViewer({ shopping: false })
    const off = await request(app).get('/api/trips/trip-1').set(viewer)
    expect(off.body.shows.shopping).toBe(false)

    await asViewer({ shopping: true })
    const on = await request(app).get('/api/trips/trip-1').set(viewer)
    expect(on.body.shows.shopping).toBe(true)
  })
})

describe('a file hanging off a stay inherits the stay', () => {
  // The case the finer-grained model creates: with documents on and stays off,
  // a hotel's reservation PDF must still disappear. Place-attached files can
  // be classified exactly, because their parent is known.
  beforeEach(async () => {
    await store.createFile(
      {
        place_id: 'place-hotel',
        display_name: 'Hotel reservation',
        storage_path: 'placeholder-files/hotel-reservation.pdf',
        mime_type: 'application/pdf',
        size_bytes: 10,
      },
      Buffer.from('pdf')
    )
  })

  it('is hidden when stays are, even with documents on', async () => {
    await asViewer({ stays: false, documents: true })
    const res = await request(app).get('/api/trips/trip-1/files').set(viewer)
    const names = res.body.files.map((f: { display_name: string }) => f.display_name)
    expect(names).not.toContain('Hotel reservation')
    // …while an ordinary trip document is still there.
    expect(names).toContain('Flight booking')
  })

  it('is shown when both are on', async () => {
    await asViewer({ stays: true, documents: true })
    const res = await request(app).get('/api/trips/trip-1/files').set(viewer)
    const names = res.body.files.map((f: { display_name: string }) => f.display_name)
    expect(names).toContain('Hotel reservation')
  })
})

describe('the flags never apply to writers', () => {
  // Stored false on an owner's row and ignored: tripView() forces the full view
  // for anyone who can write, so an owner cannot lock themselves out of their
  // own bookings by fiddling with a form.
  it('an owner with every flag off still sees everything', async () => {
    await store.upsertTripMember({
      trip_id: 'trip-1',
      user_id: OWNER_USER.id,
      role: 'owner',
      can_see_stays: false,
      can_see_flight: false,
      can_see_documents: false,
      can_see_shopping: false,
    })

    await request(app).get('/api/trips/trip-1/places/place-hotel').set(owner).expect(200)
    await request(app).get('/api/trips/trip-1/shopping').set(owner).expect(200)
    const bundle = await request(app).get('/api/trips/trip-1').set(owner)
    expect(bundle.body.flight).toBeTruthy()
    const files = await request(app).get('/api/trips/trip-1/files').set(owner)
    expect(files.body.files.length).toBeGreaterThan(0)
  })
})

describe('a viewer is read-only whatever they can see', () => {
  it.each([
    ['POST', '/places'],
    ['PATCH', '/places/place-ramen'],
    ['DELETE', '/places/place-ramen'],
    ['POST', '/tips'],
    ['POST', '/itinerary'],
    ['POST', '/shopping'],
  ])('%s %s → 403', async (method, path) => {
    await asViewer({ stays: true, flight: true, documents: true })
    const send = request(app)[method.toLowerCase() as 'post']
    const res = await send(`/api/trips/trip-1${path}`).set(viewer).send({})
    expect(res.status).toBe(403)
  })
})
