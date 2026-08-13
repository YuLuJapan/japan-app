// What the guest code holds back, beyond the documents blocked in lib/auth.ts.
//
// Stays: a hotel place *is* the reservation. What was paid, whether it is
// confirmed, the cancellation terms and the Booking.com link all live in the
// free-text description and links, so the whole category is kept out of the
// guest view rather than trying to redact prose — a price typed into a
// description tomorrow would slip straight through any such filter.
//
// Flight: same story in structured form (booking reference, ticket numbers,
// exact times), served with the trip bundle.
//
// Enforcement is server-side, in the services, because these are reads — the
// method-based block in authMiddleware only covers writes. Every route that
// can surface a place, a place id or the flight passes `!isGuest(req)`.
import type { Category, Place } from './datastore.js'

/** The category that carries the accommodation booking. */
export const STAY_CATEGORY: Category = 'hotel'

export const isStay = (place: Pick<Place, 'category'>) => place.category === STAY_CATEGORY

/** Zero out the stays so the guest view never even offers the category card. */
export function hideStayCounts(counts: Record<Category, number>): Record<Category, number> {
  return { ...counts, [STAY_CATEGORY]: 0 }
}
