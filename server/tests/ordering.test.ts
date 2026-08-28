// The client keeps a copy of the orders these lists come back in, so it can
// put a saved row back where it belongs without refetching (src/lib/ordering.ts).
//
// A copy is only honest if something notices when it drifts. These run the
// datastore and the client's comparators over the same rows — deliberately
// shuffled, and deliberately including the cases the tiebreaks exist for — and
// fail if the two ever disagree.
import { beforeEach, describe, expect, it } from 'vitest'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { fixture } from './fixture.js'
import { compareItinerary, compareShopping, compareSteps } from '../../src/lib/ordering'
import type { ItineraryItem, ShoppingItem, TripStep } from '../../src/api/types'

let store: DataStore

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
})

/** Deterministic shuffle, so a failure is reproducible. */
const shuffled = <T>(rows: T[]): T[] => {
  const out = [...rows]
  for (let i = out.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

describe('the journey', () => {
  it('comes back in the order the client would sort it into', async () => {
    // Same start date on purpose: that is what the position tiebreak is for.
    await store.createStep({
      trip_id: 'trip-1',
      zone_id: 'zone-kyoto',
      start_date: '2026-10-05',
      end_date: '2026-10-06',
      position: 9,
    })
    await store.createStep({
      trip_id: 'trip-1',
      zone_id: 'zone-kyoto',
      start_date: '2026-10-02',
      end_date: '2026-10-04',
      position: 2,
    })
    const fromStore = await store.listSteps('trip-1')
    const asClient = shuffled(fromStore).sort((a, b) =>
      compareSteps(a as unknown as TripStep, b as unknown as TripStep)
    )
    expect(asClient.map((s) => s.id)).toEqual(fromStore.map((s) => s.id))
  })
})

describe('a day plan', () => {
  it('comes back in the order the client would sort it into', async () => {
    const day = '2026-10-06'
    // A timed item, an untimed one, and two that only position separates.
    await store.createItineraryItem({ trip_id: 'trip-1', day, title: 'Late', start_time: '18:00' })
    await store.createItineraryItem({ trip_id: 'trip-1', day, title: 'Anytime' })
    await store.createItineraryItem({ trip_id: 'trip-1', day, title: 'Early', start_time: '09:00' })
    await store.createItineraryItem({ trip_id: 'trip-1', day: '2026-10-05', title: 'Day before' })

    const fromStore = await store.listItinerary('trip-1')
    const asClient = shuffled(fromStore).sort((a, b) =>
      compareItinerary(a as unknown as ItineraryItem, b as unknown as ItineraryItem)
    )
    expect(asClient.map((i) => i.title)).toEqual(fromStore.map((i) => i.title))
    // And the rule the sort exists for, stated outright: on one day, timed
    // items run in time order and untimed ones come after them.
    const mine = new Set(['Early', 'Late', 'Anytime'])
    const titles = fromStore.filter((i) => i.day === day && mine.has(i.title)).map((i) => i.title)
    expect(titles).toEqual(['Early', 'Late', 'Anytime'])
  })
})

describe('the shopping list', () => {
  it('comes back in the order the client would sort it into', async () => {
    await store.createShoppingItem({ trip_id: 'trip-1', name: 'Bought thing', bought: true })
    await store.createShoppingItem({ trip_id: 'trip-1', name: 'Still to buy' })

    const fromStore = await store.listShoppingItems('trip-1')
    const asClient = shuffled(fromStore).sort((a, b) =>
      compareShopping(a as unknown as ShoppingItem, b as unknown as ShoppingItem)
    )
    expect(asClient.map((i) => i.id)).toEqual(fromStore.map((i) => i.id))
    // Unbought first is the whole point of the list.
    expect(fromStore.filter((i) => !i.bought).length).toBeGreaterThan(0)
    expect(fromStore.at(-1)?.bought).toBe(true)
  })
})

// The export reads a whole trip at once (listAllPlaces / listAllTips) instead
// of once per zone and once per parent, which is the difference between five
// queries and sixty on a real trip. Two reads of the same rows is the same
// drift risk as a mirrored comparator, so it is pinned the same way.
describe('the export’s whole-trip sweeps', () => {
  it('return each zone’s places in the order the per-zone read does', async () => {
    await store.createPlace('trip-1', { zone_id: 'zone-kyoto', category: 'food', name: 'Nishiki' })
    await store.createPlace('trip-1', {
      zone_id: 'zone-tokyo',
      category: 'attraction',
      name: 'teamLab',
    })
    await store.createPlace('trip-1', { zone_id: 'zone-kyoto', category: 'other', name: 'Fushimi' })

    const all = await store.listAllPlaces('trip-1')
    for (const zoneId of ['zone-tokyo', 'zone-kyoto']) {
      const perZone = await store.listPlacesInZone('trip-1', zoneId)
      expect(all.filter((p) => p.zone_id === zoneId).map((p) => p.id)).toEqual(
        perZone.map((p) => p.id)
      )
      expect(perZone.length).toBeGreaterThan(0)
    }
    // And nothing from the other tenant's trip rides along.
    expect(all.some((p) => p.id === 'place-other')).toBe(false)
  })

  it('return every tip, matching the per-parent reads parent by parent', async () => {
    await store.createTip('trip-1', { zone_id: 'zone-kyoto', body: 'Rent a bike' })
    await store.createTip('trip-1', { place_id: 'place-hotel', body: 'Check in after 15:00' })

    const all = await store.listAllTips('trip-1')
    for (const zoneId of ['zone-tokyo', 'zone-kyoto']) {
      const perZone = await store.listTips('trip-1', { zone_id: zoneId })
      expect(all.filter((t) => t.zone_id === zoneId).map((t) => t.id)).toEqual(
        perZone.map((t) => t.id)
      )
    }
    for (const placeId of ['place-ramen', 'place-hotel']) {
      const perPlace = await store.listTips('trip-1', { place_id: placeId })
      expect(all.filter((t) => t.place_id === placeId).map((t) => t.id)).toEqual(
        perPlace.map((t) => t.id)
      )
    }
    // Both kinds of parent, and only this trip's.
    expect(all.some((t) => t.zone_id)).toBe(true)
    expect(all.some((t) => t.place_id)).toBe(true)
    expect(all.some((t) => t.id === 'tip-other')).toBe(false)
  })
})
