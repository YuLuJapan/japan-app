// Apply the 010 fold to server/src/data/placeholder-data.json — the same rule
// supabase/migrations/0025_activities.sql applies to Postgres (scripts/fold.ts).
//
// That file is not fixture data: it is the seed the deployed database was built
// from, and it is what local dev and every test read. It has to make the same
// journey as production or `npm test` runs against a shape the app no longer has.
//
//   npx tsx scripts/migrate-placeholder.ts --report   # print the fold candidates
//   npx tsx scripts/migrate-placeholder.ts            # rewrite the file in place
//
// The reviewed match list lives in scripts/placeholder-folds.json. A link that is
// not in it is a stray and is dropped, not folded — see migration.md §3a for why
// the name-match heuristic proposes but never decides.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { foldActivities, strayLinks, type FoldItem, type FoldPlace } from './fold'

const DATA = path.join(process.cwd(), 'server/src/data/placeholder-data.json')
const FOLDS = path.join(process.cwd(), 'scripts/placeholder-folds.json')

/** Normalised tokens, so "Kenroku-en Garden" and "Kenrokuen at opening" can meet. */
const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)

/** What share of the place's name the title repeats. Advisory only. */
function overlap(placeName: string, title: string): number {
  const p = tokens(placeName)
  if (p.length === 0) return 0
  const t = new Set(tokens(title))
  return p.filter((w) => t.has(w)).length / p.length
}

function main() {
  const data = JSON.parse(readFileSync(DATA, 'utf-8'))
  const report = process.argv.includes('--report')

  // The seed predates migration 0013, which gave a zone its own trip. Without
  // this every zone-scoped read (`listZones`, and `zoneIn` behind places, tips
  // and files) matches nothing in the memory store.
  const tripId: string = data.trips[0].id
  let backfilled = 0
  for (const zone of data.zones) {
    if (!zone.trip_id) {
      zone.trip_id = tripId
      backfilled++
    }
  }

  const places: FoldPlace[] = data.places
  const items: FoldItem[] = data.itinerary ?? []
  const placeById = new Map(places.map((p) => [p.id, p]))

  if (report) {
    const rows = items
      .filter((i) => i.place_id)
      .map((i) => {
        const p = placeById.get(i.place_id!)!
        return { o: overlap(p.name, i.title), place: p.name, cat: p.category, title: i.title }
      })
      .sort((a, b) => a.o - b.o)
    console.log(`${rows.length} linked rows — review, then edit scripts/placeholder-folds.json`)
    console.log('A low score is a QUESTION, not an answer: "Pick one" → MOA Museum scores 0.\n')
    for (const r of rows) {
      console.log(`  ${r.o.toFixed(2)}  ${r.cat.padEnd(10)} ${r.place}\n        ← ${r.title}`)
    }
    return
  }

  const matches: [string, string][] = JSON.parse(readFileSync(FOLDS, 'utf-8')).matches
  const zoneTrip = new Map<string, string>(
    data.zones.map((z: { id: string; trip_id: string }) => [z.id, z.trip_id])
  )

  const activities = foldActivities({
    places,
    items,
    matches,
    tripIdOfZone: (id) => zoneTrip.get(id) ?? tripId,
  })
  const strays = strayLinks(items, matches)

  // Children re-point by rename: a folded row kept the place's id, so every
  // place_id already names the right activity (migration.md §2).
  const repoint = (rows: { place_id?: string | null; activity_id?: string | null }[] = []) => {
    for (const row of rows) {
      row.activity_id = row.place_id ?? null
      delete row.place_id
    }
  }
  repoint(data.tips)
  repoint(data.files)

  // Keep the key order the file had, with `activities` standing where `places`
  // did and `itinerary` gone — so the diff reads as a merge rather than a
  // rewrite of a 200KB file.
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    if (key === 'places') ordered.activities = activities
    else if (key === 'itinerary') continue
    else ordered[key] = data[key]
  }

  writeFileSync(DATA, JSON.stringify(ordered, null, 2) + '\n')
  console.log(
    `folded ${places.length} places + ${items.length} items → ${activities.length} activities` +
      ` (${places.length + items.length - activities.length} folds, ${strays.length} strays dropped)`
  )
  if (backfilled) console.log(`backfilled trip_id on ${backfilled} zones (migration 0013)`)
  for (const s of strays) console.log(`  stray link dropped: ${s.id} "${s.title}"`)
}

main()
