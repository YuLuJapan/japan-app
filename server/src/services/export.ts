// Assembling one export payload: gather the trip's rows, hand them to the
// projection with the caller's view, answer.
//
// Everything about *what is in the file* is decided in lib/export-view.ts.
// This service only decides how the rows are fetched and that `detail` is one
// of the two versions. Nothing is stored: an export exists once, in the
// response, and is turned into a file on the device (research R1).
import type { DataStore } from '../lib/datastore.js'
import { validation } from '../lib/errors.js'
import {
  EXPORT_DETAILS,
  isExportDetail,
  projectExport,
  type ExportPayload,
} from '../lib/export-view.js'
import type { TripContext } from '../lib/trip-context.js'

/**
 * Five queries, not sixty.
 *
 * The per-parent reads (`listPlacesInZone`, `listTips`) would mean one query
 * per zone plus one per place — around 60 for a real trip, inside a single
 * Vercel Hobby invocation. Tests would pass instantly against the memory store
 * and the deployed endpoint would crawl. `listAllPlaces` / `listAllTips` exist
 * for this (research R5); they are the same rows in the same order.
 */
export async function buildTripExport(
  store: DataStore,
  context: TripContext,
  detail: unknown,
  /**
   * Whether identifiers ride along — `ids=1`, and only the machine-readable
   * backup asks. Not validated beyond truthiness: an unrecognised value means
   * "no", which is the safe direction and the shape of the default response.
   */
  ids: unknown = undefined
): Promise<{ export: ExportPayload }> {
  // One input, but the error still arrives as a `details` array — the shape
  // every other service in the app produces, and the shape the client already
  // knows how to render. Absent is invalid rather than defaulted: which
  // version you are exporting is never something the server should guess.
  if (!isExportDetail(detail)) {
    throw validation([`detail must be ${EXPORT_DETAILS.map((d) => `"${d}"`).join(' or ')}`])
  }

  const tripId = context.trip.id
  const [steps, zones, activities, tips] = await Promise.all([
    store.listSteps(tripId),
    store.listZones(tripId),
    store.listActivities(tripId),
    store.listAllTips(tripId),
  ])

  return {
    export: projectExport(
      context.view,
      {
        trip: context.trip,
        steps,
        zones,
        activities,
        tips,
        generated_at: new Date().toISOString(),
      },
      { detail, ids: ids === '1' || ids === 'true' }
    ),
  }
}
