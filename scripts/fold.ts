// The fold rule, in TypeScript — the mirror of supabase/migrations/0025_activities.sql.
//
// It exists twice because it has to run twice: once against the live Postgres, and
// once against server/src/data/placeholder-data.json, which is real content rather
// than fixture data (local dev and every test read it). Two implementations of one
// rule is exactly the arrangement src/lib/ordering.ts already has against the
// datastore's comparators, and it is honest for the same reason: something notices
// when they drift. `server/tests/migration-fold.test.ts` runs this over a fixture
// and compares it to output the SQL actually produced in Postgres 16.
//
// Read specs/010-activities/migration.md §3 for why the rule is shaped this way.

export interface FoldPlace {
  id: string
  zone_id: string
  category: string
  name: string
  name_ja: string | null
  description: string | null
  address: string | null
  links: unknown[]
  image_url: string | null
  lat: number | null
  lng: number | null
}

export interface FoldItem {
  id: string
  trip_id: string
  zone_id: string | null
  place_id: string | null
  day: string
  start_time: string | null
  title: string
  note: string | null
  position: number
  highlight: boolean
  icon: string | null
  category: string | null
}

export interface FoldActivity {
  id: string
  trip_id: string
  zone_id: string | null
  category: string | null
  name: string
  name_ja: string | null
  description: string | null
  address: string | null
  links: unknown[]
  image_url: string | null
  lat: number | null
  lng: number | null
  day: string | null
  start_time: string | null
  position: number
  highlight: boolean
  icon: string | null
}

/** Stays are never folded: a reservation is looked up on any night of the stay. */
const STAY = 'hotel'

// Every read of an optional column below coalesces to null rather than trusting
// the key to be there. A JSON seed row written before a column existed simply
// lacks it, and `undefined` is not `null`: JSON.stringify drops the key entirely,
// so the rewritten file would be missing `lat`/`lng` on every row. SQL has no
// such state — an absent column reads as NULL — and this has to match.

/** Postgres `nullif(x, '')` — an empty string is not a value. */
const blankToNull = (v: string | null | undefined): string | null => (v ? v : null)

/** Postgres `concat_ws(E'\n\n', …)`: nulls are skipped, not rendered. */
const joinParagraphs = (...parts: (string | null)[]): string | null =>
  blankToNull(parts.filter((p): p is string => p !== null).join('\n\n'))

/**
 * The description a folded row carries: the place's, then the item's note, then the
 * place's name where the item renamed it.
 *
 * The note is dropped only when it repeats the description **word for word**. A
 * near-duplicate is left in, because redundant text can be edited away and dropped
 * text cannot.
 */
export function foldedDescription(place: FoldPlace, item: FoldItem): string | null {
  const placeDesc = blankToNull(place.description)
  const note = blankToNull(item.note)
  const repeats = (note ?? '').trim() === (place.description ?? '').trim()
  const renamed = item.title.trim().toLowerCase() !== place.name.trim().toLowerCase()
  return joinParagraphs(
    placeDesc,
    repeats ? null : note,
    renamed ? `Saved as "${place.name}"` : null
  )
}

/** `order by day, position, id` — the SQL's window, so the same item folds. */
const byPlanOrder = (a: FoldItem, b: FoldItem): number =>
  a.day !== b.day
    ? a.day < b.day
      ? -1
      : 1
    : a.position !== b.position
      ? a.position - b.position
      : a.id < b.id
        ? -1
        : 1

export interface FoldInput {
  places: FoldPlace[]
  items: FoldItem[]
  /** The reviewed (place_id, item_id) pairs — §3a. An unlisted link is a stray. */
  matches: [string, string][]
  /** Places carry no trip of their own; it comes from their zone. */
  tripIdOfZone: (zoneId: string) => string
}

export function foldActivities({
  places,
  items,
  matches,
  tripIdOfZone,
}: FoldInput): FoldActivity[] {
  const placeById = new Map(places.map((p) => [p.id, p]))
  const itemById = new Map(items.map((i) => [i.id, i]))

  // Which matched item folds into its place, and which are copies. Mirrors the
  // `_fold` temporary table: matched pairs only, stays excluded.
  const matchedByPlace = new Map<string, FoldItem[]>()
  const matchedItemIds = new Set<string>()
  for (const [placeId, itemId] of matches) {
    matchedItemIds.add(itemId)
    const place = placeById.get(placeId)
    const item = itemById.get(itemId)
    if (!place || !item || place.category === STAY) continue
    const bucket = matchedByPlace.get(placeId)
    if (bucket) bucket.push(item)
    else matchedByPlace.set(placeId, [item])
  }
  const foldTarget = new Map<string, FoldItem>()
  const copyOf = new Map<string, FoldPlace>()
  for (const [placeId, bucket] of matchedByPlace) {
    const sorted = [...bucket].sort(byPlanOrder)
    foldTarget.set(placeId, sorted[0])
    for (const copy of sorted.slice(1)) copyOf.set(copy.id, placeById.get(placeId)!)
  }
  const foldedItemIds = new Set([...foldTarget.values()].map((i) => i.id))

  // Places become rows, carrying their folded item's schedule where there is one.
  const fromPlaces = places.map((place): FoldActivity => {
    const item = foldTarget.get(place.id) ?? null
    return {
      id: place.id,
      trip_id: tripIdOfZone(place.zone_id),
      zone_id: place.zone_id,
      category: item?.category ?? place.category,
      // The item's title wins: the day plan is the surface these rows are read on.
      name: item?.title ?? place.name,
      name_ja: place.name_ja ?? null,
      description: item ? foldedDescription(place, item) : blankToNull(place.description),
      address: place.address ?? null,
      links: place.links ?? [],
      image_url: place.image_url ?? null,
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      day: item?.day ?? null,
      start_time: item?.start_time ?? null,
      position: item?.position ?? 0,
      highlight: item?.highlight ?? false,
      icon: item?.icon ?? null,
    }
  })

  // Every item that did not fold stays exactly as it is — including a stray, whose
  // place_id says nothing about where the activity is, and an item hanging off a
  // stay, which must not be re-tagged `hotel` (see §3). Only a matched copy is
  // touched, and only to carry the pin.
  const fromItems = items
    .filter((item) => !foldedItemIds.has(item.id))
    .map((item): FoldActivity => {
      const place = copyOf.get(item.id) ?? null
      return {
        id: item.id,
        trip_id: item.trip_id,
        zone_id: item.zone_id ?? null,
        category: item.category ?? place?.category ?? null,
        name: item.title,
        name_ja: null,
        description: blankToNull(item.note),
        address: place?.address ?? null,
        links: [],
        image_url: place?.image_url ?? null,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
        day: item.day,
        start_time: item.start_time ?? null,
        position: item.position ?? 0,
        highlight: item.highlight ?? false,
        icon: item.icon ?? null,
      }
    })

  return [...fromPlaces, ...fromItems].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Unmatched links, for the report: the rows whose `place_id` the fold ignored. */
export const strayLinks = (items: FoldItem[], matches: [string, string][]): FoldItem[] => {
  const matched = new Set(matches.map(([, itemId]) => itemId))
  return items.filter((i) => i.place_id && !matched.has(i.id))
}
