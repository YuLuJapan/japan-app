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
