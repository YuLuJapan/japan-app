// Which visit a zone is, and which visit a day belongs to.
//
// A zone is one *visit* to a city (spec 011), so a trip that goes to Tokyo
// twice holds two zone rows tied together by `city_key`. Everything a screen
// needs to say about that — "19–25 Sep", "2nd visit", which other stays a
// place could be moved to — is derived from the trip's zones and steps rather
// than stored, so a stop's date change relabels every surface with no write.
//
// Pure: takes rows, returns data. No store, no HTTP. That is what lets the
// export, the zone service and the split script share one answer.
import type { JourneyStep, Zone } from './datastore.js'

/** One other visit of the same city, for the move picker. */
export interface VisitSibling {
  zone_id: string
  start_date: string | null
  end_date: string | null
  ordinal: number
}

/**
 * A zone's place among the visits of its city.
 *
 * `total === 1` is the ordinary case and the whole of FR-003: a city visited
 * once has no siblings, so every surface derives an empty label and renders
 * nothing new. Single-visit cities are unchanged by construction rather than
 * by a special case.
 */
export interface Visit {
  /** Null when the visit is no longer on the journey — a stop was deleted and
   *  its content deliberately kept (FR-011). The page still opens. */
  step_id: string | null
  start_date: string | null
  end_date: string | null
  /** 1-based among siblings, by start_date then position. */
  ordinal: number
  /** Siblings including this one. 1 means "not a repeated city". */
  total: number
  siblings: VisitSibling[]
}

/** Ordered as the visits of a city read on the journey: by date, then position. */
function byJourney(a: JourneyStep | undefined, b: JourneyStep | undefined): number {
  if (!a && !b) return 0
  // A visit with no step sorts last: it is not on the journey any more.
  if (!a) return 1
  if (!b) return -1
  if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1
  return a.position - b.position
}

/**
 * Everything a screen needs to say about which visit this zone is.
 *
 * Takes the trip's whole zone and step lists because the caller already has
 * them — `listZones` is one query and the journey needs the steps anyway — and
 * because siblings cannot be answered from one row.
 */
export function visitOf(zone: Zone, zones: Zone[], steps: JourneyStep[]): Visit {
  const stepFor = (zoneId: string) => steps.find((s) => s.zone_id === zoneId)

  // A null key means "no siblings", which is how a city visited once behaves.
  // Grouping the null-keyed zones together instead would make every unnamed
  // zone a sibling of every other one.
  const family =
    zone.city_key == null
      ? [zone]
      : zones.filter((z) => z.city_key != null && z.city_key === zone.city_key)

  const ordered = [...family].sort((a, b) => byJourney(stepFor(a.id), stepFor(b.id)))
  const index = ordered.findIndex((z) => z.id === zone.id)
  const step = stepFor(zone.id)

  return {
    step_id: step?.id ?? null,
    start_date: step?.start_date ?? null,
    end_date: step?.end_date ?? null,
    ordinal: index + 1,
    total: ordered.length,
    siblings: ordered
      .map((z, i) => ({ zone: z, ordinal: i + 1 }))
      .filter(({ zone: z }) => z.id !== zone.id)
      .map(({ zone: z, ordinal }) => {
        const s = stepFor(z.id)
        return {
          zone_id: z.id,
          start_date: s?.start_date ?? null,
          end_date: s?.end_date ?? null,
          ordinal,
        }
      }),
  }
}

/**
 * The step a day belongs to: the one the traveller sleeps in that night.
 *
 * **This is not a new rule.** It mirrors `primaryStep` in `src/lib/schedule.ts`
 * exactly, and it has to: stop ranges overlap by a day at every handover (all
 * nine of them on the Japan trip), and `Schedule.tsx` already files a
 * newly-added activity against `primaryStep`'s answer. A second definition
 * here would file an activity against one visit and link it to another.
 *
 * The client owns the wording, the server owns this; `server/tests/visit.test.ts`
 * runs both over the same rows so the copies cannot drift, exactly as
 * `server/tests/ordering.test.ts` does for the datastore's ordering.
 *
 * On a travel day that is the arrival city; on the trip's final day, where no
 * covering step has a later end, it is the last stay. Null when nothing covers
 * the day.
 */
export function visitForDay(steps: JourneyStep[], day: string): JourneyStep | null {
  const covering = steps.filter((s) => s.start_date <= day && day <= s.end_date)
  if (covering.length === 0) return null
  const staying = covering.find((s) => day < s.end_date)
  if (staying) return staying
  return covering.reduce((a, b) => (a.end_date >= b.end_date ? a : b))
}
