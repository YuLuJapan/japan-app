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
import type { Activity, Category, ShoppingItem, TripStep } from '../api/types'
import { CATEGORIES } from '../api/types'

/** The journey: by start date, then manual position, then id. */
export const compareSteps = (a: TripStep, b: TripStep): number => {
  if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}

/** A day plan: by day, timed items before untimed, then position, then id. */
const compareScheduled = (a: Activity, b: Activity): number => {
  if (a.day !== b.day) return (a.day ?? '') < (b.day ?? '') ? -1 : 1
  if (a.start_time !== b.start_time) {
    if (a.start_time === null) return 1
    if (b.start_time === null) return -1
    return a.start_time < b.start_time ? -1 : 1
  }
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}

/**
 * Explore's order, for activities with no date: by category in the app's own
 * order, then position, then name, then id. An untagged row sorts last, where
 * "More" is.
 */
const compareSaved = (a: Activity, b: Activity): number => {
  const rank = (c: Category | null) => (c === null ? CATEGORIES.length : CATEGORIES.indexOf(c))
  if (rank(a.category) !== rank(b.category)) return rank(a.category) - rank(b.category)
  if (a.position !== b.position) return a.position - b.position
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.id < b.id ? -1 : 1
}

/**
 * The one list every screen filters: scheduled activities first in day order,
 * then the saved ones in Explore order. Two orders in one array, so a caller
 * never has to ask which list it is reading.
 */
export const compareActivities = (a: Activity, b: Activity): number => {
  if ((a.day === null) !== (b.day === null)) return a.day === null ? 1 : -1
  return a.day === null ? compareSaved(a, b) : compareScheduled(a, b)
}

/** The shopping list: still to buy first, then position, then id. */
export const compareShopping = (a: ShoppingItem, b: ShoppingItem): number => {
  if (a.bought !== b.bought) return a.bought ? 1 : -1
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : 1
}
