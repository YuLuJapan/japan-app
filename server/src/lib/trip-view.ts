// What a caller is shown on a trip, as one value rather than a handful of
// loose booleans threaded through six services.
//
// This began as lib/guest-view.ts, which answered one question — "is this the
// guest code?" — and handed the services `includeStays` / `includeFlight` /
// `includeFiles` flags derived from it. The flags were always the right shape;
// they were just named after the single case that needed them. Swapping the
// *source* from a global role to a trip_members row changed nothing
// downstream, and the guest code itself is now gone.
//
// Why whole categories rather than redaction: a `hotel` place *is* the
// accommodation booking. What was paid, whether it is confirmed, the
// cancellation terms and the Booking.com link all live in its free-text
// description and links, so the category is withheld entirely — a price typed
// into a description tomorrow would slip straight through any filter. The
// flight is the same story in structured form. The shopping list is withheld
// wholesale for a different reason: it is where the gifts get written down, so
// the person it should be hidden from is often the very person you are sharing
// the rest of the trip with.
import type { Category, Place, TripMember } from './datastore.js'
import { canWrite } from './permissions.js'

export interface TripView {
  /** The stays — a hotel place carries the reservation. */
  stays: boolean
  /** The flight block on the trip bundle: booking reference, ticket numbers. */
  flight: boolean
  /** Attachments: the Documents tab, and files hung off a zone or place. */
  documents: boolean
  /** The shopping list: the Shopping tab, and everything under it. */
  shopping: boolean
}

/** Everyone who can write, and every owner. */
export const FULL_VIEW: TripView = {
  stays: true,
  flight: true,
  documents: true,
  shopping: true,
}

/**
 * What this member is shown.
 *
 * Writers always see everything: the flags are *ignored* for owner and partner
 * rather than validated, so an owner can never lock themselves out of their own
 * bookings by fiddling with a form. They exist for viewers.
 */
export function tripView(
  member: Pick<
    TripMember,
    'role' | 'can_see_stays' | 'can_see_flight' | 'can_see_documents' | 'can_see_shopping'
  >
): TripView {
  if (canWrite(member.role)) return FULL_VIEW
  return {
    stays: member.can_see_stays,
    flight: member.can_see_flight,
    documents: member.can_see_documents,
    shopping: member.can_see_shopping,
  }
}

/** The category that carries the accommodation booking. */
export const STAY_CATEGORY: Category = 'hotel'

export const isStay = (place: Pick<Place, 'category'>) => place.category === STAY_CATEGORY

/** Zero out the stays so a restricted view never even offers the category card. */
export function hideStayCounts(counts: Record<Category, number>): Record<Category, number> {
  return { ...counts, [STAY_CATEGORY]: 0 }
}
