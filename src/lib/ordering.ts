// The orders the API returns lists in, mirrored so the client can put a saved
// row back where it belongs.
//
// A write returns the row it changed, not the list — so when a change can move
// something (a re-dated stop, an activity given a time, an item ticked off),
// the client has to know the order to put it back in. These are that order.
//
// They are a mirror, not a source: the datastore defines it
// (`server/src/lib/datastore.memory.ts` comparators, and the matching SQL
// `.order()` in the Supabase store). `server/tests/ordering.test.ts` runs both
// against the same rows and fails if they ever disagree — which is the only
// thing that makes keeping a copy here honest.
import type { ItineraryItem, ShoppingItem, TripStep } from '../api/types'

/** The journey: by start date, then manual position, then id. */
export const compareSteps = (a: TripStep, b: TripStep): number => {
  if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}

/**
 * The four fields the day plan's order is made of. Named so a projection of an
 * activity — the planned rows in `lib/explore.ts` — can be sorted by the same
 * comparator instead of a second copy of the rule.
 */
export type ItineraryOrder = Pick<ItineraryItem, 'day' | 'start_time' | 'position' | 'id'>

/** A day plan: by day, timed items before untimed, then position, then id. */
export const compareItinerary = (a: ItineraryOrder, b: ItineraryOrder): number => {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1
  if (a.start_time !== b.start_time) {
    if (a.start_time === null) return 1
    if (b.start_time === null) return -1
    return a.start_time < b.start_time ? -1 : 1
  }
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}

/** The shopping list: still to buy first, then position, then id. */
export const compareShopping = (a: ShoppingItem, b: ShoppingItem): number => {
  if (a.bought !== b.bought) return a.bought ? 1 : -1
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}
