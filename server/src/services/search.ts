import type { DataStore } from '../lib/datastore.js'
import { CATEGORIES } from '../lib/datastore.js'
import { STAY_CATEGORY, isStay } from '../lib/trip-view.js'

export interface SearchResult {
  type: 'activity' | 'zone' | 'tip'
  id: string
  title: string
  subtitle: string
  href: string
}

/** `includeStays: false` keeps the hidden stays out of the results — both the
 *  stays themselves and the tips that would link straight to one. */
/**
 * Search within one trip.
 *
 * Phase 3a-ii had to filter the store's catalog-wide results back down by zone
 * reachability. Since zones are trip-scoped (migration 0013) the store answers
 * the scoped question directly, so that shim is gone — the trip id is the
 * filter.
 */
export async function searchAll(
  store: DataStore,
  tripId: string,
  query: string,
  { includeStays = true }: { includeStays?: boolean } = {}
): Promise<{ results: SearchResult[] }> {
  const q = query.trim()
  if (q.length < 2) return { results: [] }

  const { activities, zones, tips: allTips } = await store.search(tripId, q)
  const zoneName = new Map(zones.map((z) => [z.id, z.name]))

  let matched = activities
  let tips = allTips
  if (!includeStays) {
    // Both halves of FR-020/FR-021 land in the same place here: a *saved* stay
    // is withheld, and a *scheduled* one is stripped of everything a result
    // renders — so neither has anything to show and both leave the list.
    matched = activities.filter((a) => !isStay(a))
    // A tip's own parent may be a stay that never matched the query itself.
    const stayIds = new Set(await store.listActivityIdsByCategory(tripId, STAY_CATEGORY))
    tips = allTips.filter((t) => !t.activity_id || !stayIds.has(t.activity_id))
  }

  const results: SearchResult[] = [
    ...zones.map((z) => ({
      type: 'zone' as const,
      id: z.id,
      title: z.name,
      subtitle: 'Zone',
      href: `/zones/${z.id}`,
    })),
    ...matched.map((a) => ({
      type: 'activity' as const,
      id: a.id,
      title: a.name,
      subtitle: a.category && CATEGORIES.includes(a.category) ? a.category : 'activity',
      href: `/activities/${a.id}`,
    })),
    ...tips.map((t) => ({
      type: 'tip' as const,
      id: t.id,
      title: t.body.length > 80 ? `${t.body.slice(0, 80)}…` : t.body,
      subtitle: t.zone_id ? `Tip · ${zoneName.get(t.zone_id) ?? 'zone'}` : 'Tip',
      href: t.activity_id ? `/activities/${t.activity_id}` : `/zones/${t.zone_id}`,
    })),
  ]
  return { results }
}
