import type { DataStore, Tip } from '../lib/datastore.js'
import { CATEGORIES } from '../lib/datastore.js'
import { canReachZone, reachableZoneIds, type AccessContext } from '../lib/access.js'
import { STAY_CATEGORY, isStay } from '../lib/guest-view.js'

export interface SearchResult {
  type: 'place' | 'zone' | 'tip'
  id: string
  title: string
  subtitle: string
  href: string
}

/** `includeStays: false` keeps the guest view's hidden stays out of the results — both the
 *  stays themselves and the tips that would link straight to one. */
/**
 * `store.search` is catalog-wide — it has no notion of trips — so every result
 * has to be filtered back down to what the caller can actually reach.
 *
 * A tip's own parent decides its visibility: a zone tip by that zone, a place
 * tip by its place's zone. Matching tips are few, so resolving those places
 * individually is cheaper than loading the catalog.
 */
async function reachableTips(
  store: DataStore,
  tips: Tip[],
  zones: ReadonlySet<string> | 'all'
): Promise<Tip[]> {
  if (zones === 'all') return tips
  const out: Tip[] = []
  for (const tip of tips) {
    if (tip.zone_id) {
      if (canReachZone(zones, tip.zone_id)) out.push(tip)
      continue
    }
    if (!tip.place_id) continue
    const parent = await store.getPlace(tip.place_id)
    if (parent && canReachZone(zones, parent.zone_id)) out.push(tip)
  }
  return out
}

export async function searchAll(
  store: DataStore,
  access: AccessContext,
  query: string,
  { includeStays = true }: { includeStays?: boolean } = {}
): Promise<{ results: SearchResult[] }> {
  const q = query.trim()
  if (q.length < 2) return { results: [] }

  const found = await store.search(q)

  // Search reached across every trip in the database until this landed: the
  // titles it returns are place names, zone names and the first 80 characters
  // of a tip, so an account that is a member of nothing could read other
  // people's notes by guessing a word. Zones are not trip-scoped in the schema
  // until phase 3b; until then reachability is what stands in for it.
  const reachable = await reachableZoneIds(store, access)
  const zones = found.zones.filter((z) => canReachZone(reachable, z.id))
  const places = found.places.filter((p) => canReachZone(reachable, p.zone_id))
  const allTips = await reachableTips(store, found.tips, reachable)

  const zoneName = new Map(zones.map((z) => [z.id, z.name]))

  let matchedPlaces = places
  let tips = allTips
  if (!includeStays) {
    matchedPlaces = places.filter((p) => !isStay(p))
    // A tip's own parent may be a stay that never matched the query itself.
    const stayIds = new Set(await store.listPlaceIdsByCategory(STAY_CATEGORY))
    tips = allTips.filter((t) => !t.place_id || !stayIds.has(t.place_id))
  }

  const results: SearchResult[] = [
    ...zones.map((z) => ({
      type: 'zone' as const,
      id: z.id,
      title: z.name,
      subtitle: 'Zone',
      href: `/zones/${z.id}`,
    })),
    ...matchedPlaces.map((p) => ({
      type: 'place' as const,
      id: p.id,
      title: p.name,
      subtitle: CATEGORIES.includes(p.category) ? p.category : 'place',
      href: `/places/${p.id}`,
    })),
    ...tips.map((t) => ({
      type: 'tip' as const,
      id: t.id,
      title: t.body.length > 80 ? `${t.body.slice(0, 80)}…` : t.body,
      subtitle: t.zone_id ? `Tip · ${zoneName.get(t.zone_id) ?? 'zone'}` : 'Tip',
      href: t.place_id ? `/places/${t.place_id}` : `/zones/${t.zone_id}`,
    })),
  ]
  return { results }
}
