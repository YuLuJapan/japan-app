// The shipped seed has to be readable through the store.
//
// `server/src/data/placeholder-data.json` is not fixture data — it is the real
// trip, it is what `DATA_BACKEND=memory` serves in local dev, and it is what
// `npm run seed` inserts into Supabase. Every other test builds its own
// `fixture()`, so nothing has ever read this file, and it drifted: its zones
// carried no `trip_id` after migration 0013 made zones trip-scoped. The result
// was a journey listing ten stops where every city page 404'd, and a seed
// script that would fail on a NOT NULL column — with a fully green suite.
//
// These assertions are deliberately about referential integrity rather than
// content: they must not need updating when a place is added or a tip reworded.
import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/lib/datastore.memory.js'

// No argument: exactly how local dev loads it.
const store = createMemoryStore()
const TRIP = 'trip-japan'

describe('the shipped seed', () => {
  it('is scoped to its trip, so the store can actually see its zones', async () => {
    const zones = await store.listZones(TRIP)
    expect(zones.length).toBeGreaterThan(0)
    for (const zone of zones) expect(zone.trip_id).toBe(TRIP)
  })

  it('gives every zone a city_key, so visits of one city can find each other', async () => {
    // Migration 0023 backfills the same value in Postgres; the two have to
    // agree or a zone created by the app and one seeded here stop being
    // siblings (server/tests/city-key.test.ts pins the expression).
    for (const zone of await store.listZones(TRIP)) expect(zone.city_key).toBeTruthy()
  })

  it('points every journey stop at a zone that resolves', async () => {
    // The failure this catches is silent: a step whose zone is missing renders
    // as a card with no city on it.
    for (const step of await store.listSteps(TRIP)) {
      expect(await store.getZone(TRIP, step.zone_id)).not.toBeNull()
    }
  })

  it('opens every city page it lists — places, tips and counts included', async () => {
    for (const zone of await store.listZones(TRIP)) {
      const places = await store.listPlacesInZone(TRIP, zone.id)
      const counts = await store.countPlacesByCategory(TRIP, zone.id)
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      // The count and the list are two code paths over the same rows; a zone
      // the store cannot see answers 0 for both, so compare against the
      // trip-wide sweep as well.
      expect(total).toBe(places.length)
    }
    const all = await store.listAllPlaces(TRIP)
    const perZone = (await store.listZones(TRIP)).reduce(async (sum, z) => {
      return (await sum) + (await store.listPlacesInZone(TRIP, z.id)).length
    }, Promise.resolve(0))
    expect(await perZone).toBe(all.length)
  })

  it('hangs every place on a zone of this trip', async () => {
    const zoneIds = new Set((await store.listZones(TRIP)).map((z) => z.id))
    for (const place of await store.listAllPlaces(TRIP)) {
      expect(zoneIds.has(place.zone_id)).toBe(true)
    }
  })
})
