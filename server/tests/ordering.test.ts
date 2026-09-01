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
import { compareActivities, compareShopping, compareSteps } from '../../src/lib/ordering'
import type { Activity, ShoppingItem, TripStep } from '../../src/api/types'

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

describe('the one activities list', () => {
  it('comes back in the order the client would sort it into', async () => {
    const day = '2026-10-06'
    // A timed item, an untimed one, and two that only position separates.
    const zone_id = 'zone-tokyo'
    await store.createActivity({ trip_id: 'trip-1', day, name: 'Late', start_time: '18:00' })
    await store.createActivity({ trip_id: 'trip-1', day, name: 'Anytime' })
    await store.createActivity({ trip_id: 'trip-1', day, name: 'Early', start_time: '09:00' })
    await store.createActivity({ trip_id: 'trip-1', day: '2026-10-05', name: 'Day before' })
    // And the saved half, which sorts by a different rule in the same array.
    await store.createActivity({ trip_id: 'trip-1', zone_id, name: 'A shop', category: 'shopping' })
    await store.createActivity({ trip_id: 'trip-1', zone_id, name: 'A cafe', category: 'food' })

    const fromStore = await store.listActivities('trip-1')
    const asClient = shuffled(fromStore).sort((a, b) =>
      compareActivities(a as unknown as Activity, b as unknown as Activity)
    )
    expect(asClient.map((i) => i.name)).toEqual(fromStore.map((i) => i.name))
    // And the rule the sort exists for, stated outright: on one day, timed
    // items run in time order and untimed ones come after them.
    const mine = new Set(['Early', 'Late', 'Anytime'])
    const titles = fromStore.filter((i) => i.day === day && mine.has(i.name)).map((i) => i.name)
    expect(titles).toEqual(['Early', 'Late', 'Anytime'])
    // Scheduled before saved: two orders in one array, and the boundary is the
    // date. A screen filtering this list never has to ask which half it is in.
    const days = fromStore.map((a) => a.day)
    expect(days.indexOf(null)).toBe(days.filter((d) => d !== null).length)
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

// The export reads a whole trip at once (listActivities / listAllTips) instead
// of once per zone and once per parent, which is the difference between five
// queries and sixty on a real trip. Two reads of the same rows is the same
// drift risk as a mirrored comparator, so it is pinned the same way.
//
// Since 010 there is only one activities read, so what is pinned here is that
// slicing it by zone still reads as a zone-scoped query would have.
describe('the export’s whole-trip sweeps', () => {
  it('slice by zone the way a zone-scoped read would', async () => {
    const trip_id = 'trip-1'
    await store.createActivity({
      trip_id,
      zone_id: 'zone-kyoto',
      category: 'food',
      name: 'Nishiki',
    })
    await store.createActivity({
      trip_id,
      zone_id: 'zone-tokyo',
      category: 'attraction',
      name: 'teamLab',
    })
    await store.createActivity({
      trip_id,
      zone_id: 'zone-kyoto',
      category: 'other',
      name: 'Fushimi',
    })

    const all = await store.listActivities(trip_id)
    for (const zoneId of ['zone-tokyo', 'zone-kyoto']) {
      const saved = all.filter((a) => a.zone_id === zoneId && a.day === null)
      expect(saved.length).toBeGreaterThan(0)
      // Sorted already, so a screen filtering it never re-sorts.
      const resorted = shuffled(saved).sort((a, b) =>
        compareActivities(a as unknown as Activity, b as unknown as Activity)
      )
      expect(resorted.map((a) => a.id)).toEqual(saved.map((a) => a.id))
    }
    // And nothing from the other tenant's trip rides along.
    expect(all.some((a) => a.id === 'place-other')).toBe(false)
  })

  it('return every tip, matching the per-parent reads parent by parent', async () => {
    await store.createTip('trip-1', { zone_id: 'zone-kyoto', body: 'Rent a bike' })
    await store.createTip('trip-1', { activity_id: 'place-hotel', body: 'Check in after 15:00' })

    const all = await store.listAllTips('trip-1')
    for (const zoneId of ['zone-tokyo', 'zone-kyoto']) {
      const perZone = await store.listTips('trip-1', { zone_id: zoneId })
      expect(all.filter((t) => t.zone_id === zoneId).map((t) => t.id)).toEqual(
        perZone.map((t) => t.id)
      )
    }
    for (const placeId of ['place-ramen', 'place-hotel']) {
      const perPlace = await store.listTips('trip-1', { activity_id: placeId })
      expect(all.filter((t) => t.activity_id === placeId).map((t) => t.id)).toEqual(
        perPlace.map((t) => t.id)
      )
    }
    // Both kinds of parent, and only this trip's.
    expect(all.some((t) => t.zone_id)).toBe(true)
    expect(all.some((t) => t.activity_id)).toBe(true)
    expect(all.some((t) => t.id === 'tip-other')).toBe(false)
  })
})
