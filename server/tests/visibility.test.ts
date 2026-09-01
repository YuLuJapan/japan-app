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
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { OWNER_USER, VIEWER_USER, fixture } from './fixture.js'
import { useTestTokens } from './auth.js'

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

const viewer = { Authorization: 'Bearer viewer.jwt' }
const owner = { Authorization: 'Bearer owner.jwt' }

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
})

describe('stays', () => {
  // 010 split this rule in two, because a stay is now an activity and an
  // activity may or may not have a date.
  //
  //   FR-020 · a **saved** stay IS the booking → withheld wholesale.
  //   FR-021 · a **scheduled** one is a line on a day → the line survives and
  //            everything else goes, its category included.
  //
  // Dropping the scheduled row instead would leave a hole in the day that says
  // something was there; keeping its content would put the hotel back.

  it('withholds a saved stay entirely: the page, the count and the search hit', async () => {
    await asViewer({ stays: false })

    await request(app).get('/api/trips/trip-1/activities/place-hotel').set(viewer).expect(403)

    const zone = await request(app).get('/api/trips/trip-1/zones/zone-tokyo').set(viewer)
    expect(zone.body.saved_counts.hotel).toBe(0)

    const list = await request(app).get('/api/trips/trip-1/activities').set(viewer)
    const ids = list.body.activities.map((a: { id: string }) => a.id)
    expect(ids).not.toContain('place-hotel')
    expect(ids).not.toContain('place-ryokan')
    expect(ids).toContain('place-ramen') // everything else is untouched

    const search = await request(app).get('/api/trips/trip-1/search?q=Hotel').set(viewer)
    expect(search.body.results).toEqual([])
  })

  it('keeps a scheduled stay’s line and takes everything else off it', async () => {
    await asViewer({ stays: false })
    const res = await request(app).get('/api/trips/trip-1/activities').set(viewer)
    const ryokan = res.body.activities.find((a: { id: string }) => a.id === 'itin-ryokan')

    // The line survives — it is what the day says happened.
    expect(ryokan).toBeTruthy()
    expect(ryokan.name).toBe('Check into the ryokan')
    expect(ryokan.day).toBe('2026-10-10')
    expect(ryokan.start_time).toBe('15:00')

    // And nothing that would name the hotel does. The category above all: it is
    // what draws the coloured pill, and a pill reading "Stays" would announce
    // exactly what the flag withholds.
    expect(ryokan.category).toBeNull()
    expect(ryokan.description).toBeNull()
    expect(ryokan.address).toBeNull()
    expect(ryokan.links).toEqual([])
    expect(ryokan.lat).toBeNull()
    expect(ryokan.lng).toBeNull()
    expect(ryokan.file_count).toBe(0)

    // An activity that is not a stay keeps its own tag.
    const ramen = res.body.activities.find((a: { id: string }) => a.id === 'itin-ramen')
    expect(ramen.category).toBe('food')
  })

  it('refuses the detail page for a scheduled stay, and strips what it returns', async () => {
    await asViewer({ stays: false })
    // Not a 403 — the row exists on their day plan, so the page has to open —
    // but it opens on the stripped row, with no tips and no documents.
    const res = await request(app).get('/api/trips/trip-1/activities/itin-ryokan').set(viewer)
    expect(res.status).toBe(200)
    expect(res.body.activity.name).toBe('Check into the ryokan')
    expect(res.body.activity.address).toBeNull()
    expect(res.body.tips).toEqual([])
    expect(res.body.files).toEqual([])
  })

  it('shows all of it when the flag is on', async () => {
    await asViewer({ stays: true })
    await request(app).get('/api/trips/trip-1/activities/place-hotel').set(viewer).expect(200)
    const zone = await request(app).get('/api/trips/trip-1/zones/zone-tokyo').set(viewer)
    expect(zone.body.saved_counts.hotel).toBe(1)

    const res = await request(app).get('/api/trips/trip-1/activities').set(viewer)
    const ryokan = res.body.activities.find((a: { id: string }) => a.id === 'itin-ryokan')
    expect(ryokan.category).toBe('hotel')
    expect(ryokan.address).toBe('3 Higashiyama, Kyoto')
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

  // Before 010 the plan named the files on the place an entry linked to; a name
  // is a document, so that had to be gated. A list carries a *count* now, and a
  // count still says one exists — so it is gated on the same flag.
  it('zeroes the document count on every activity', async () => {
    await asViewer({ documents: false })
    const res = await request(app).get('/api/trips/trip-1/activities').set(viewer)
    const ramen = res.body.activities.find((a: { id: string }) => a.id === 'place-ramen')
    expect(ramen.file_count).toBe(0)
  })

  it('counts them when documents are shared', async () => {
    await asViewer({ documents: true })
    const res = await request(app).get('/api/trips/trip-1/activities').set(viewer)
    const ramen = res.body.activities.find((a: { id: string }) => a.id === 'place-ramen')
    expect(ramen.file_count).toBe(1)
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
        activity_id: 'place-hotel',
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

    await request(app).get('/api/trips/trip-1/activities/place-hotel').set(owner).expect(200)
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
