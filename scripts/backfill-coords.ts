// Give the places that already exist a location (feature 004, FR-001/FR-002).
//
// 0 of 39 places carry coordinates, and no map can be honest until they do.
// The lookup is Nominatim's, whose usage policy allows one request per second
// — which is why this is a script and not an endpoint: a serverless request
// cannot hold that rate, and 39 places is 39 seconds.
//
// **This is the only thing in the feature that writes to production rows**, so
// it does not rely on being right:
//
//   npm run backfill:coords                          # dry run — the default
//   npm run backfill:coords -- --apply               # writes, and journals
//   npm run backfill:coords -- --revert <journal>    # puts the old values back
//
// Idempotent (a place that already has coordinates is skipped, so a re-run is
// safe and an interrupted run resumes), rate-limited, and it closes by naming
// every place it could not resolve — a silent unresolved place is the failure
// this exists to prevent.
//
// Address lookup is confident about wrong answers: a Kyoto place with a Tokyo
// latitude looks exactly like a success in the log. Spot-check the results
// (quickstart §A2); the journal makes a bad batch one command to undo.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadEnv } from './loadEnv'

loadEnv()

/** Nominatim's usage policy. The wait is per lookup, not per place. */
const RATE_LIMIT_MS = 1000

const JOURNAL_DIR = path.join(process.cwd(), 'scripts/.backfill')

interface JournalEntry {
  id: string
  name: string
  before: { lat: number | null; lng: number | null }
  after: { lat: number | null; lng: number | null }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** `--flag value` → value; `--flag` → '' when present; undefined when absent. */
function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  if (i === -1) return undefined
  const next = argv[i + 1]
  return next && !next.startsWith('--') ? next : ''
}

/**
 * Which trips to walk.
 *
 * The store deliberately has no unscoped `listTrips()` (datastore.ts: the only
 * correct number of call sites was zero), so the trip is named — by `--trip`,
 * or by the seed file the deployed database was built from.
 */
function tripIds(argv: string[]): string[] {
  const named = arg(argv, '--trip')
  if (named) return [named]
  const seed = path.join(process.cwd(), 'server/src/data/placeholder-data.json')
  const data = JSON.parse(readFileSync(seed, 'utf-8')) as { trips: { id: string }[] }
  return data.trips.map((t) => t.id)
}

async function revert(journalPath: string, argv: string[]) {
  const { getDataStore } = await import('../server/src/lib/datastore')
  const store = await getDataStore()
  const entries = JSON.parse(readFileSync(journalPath, 'utf-8')) as JournalEntry[]
  const ids = tripIds(argv)

  let restored = 0
  for (const entry of entries) {
    // The journal records a place, not a trip; each write is scoped by the
    // trip it belongs to, so the wrong trip cannot be patched by a stale file.
    for (const tripId of ids) {
      const place = await store.updateActivity(tripId, entry.id, {
        lat: entry.before.lat,
        lng: entry.before.lng,
      })
      if (place) {
        restored += 1
        console.log(`↩ ${entry.name}: ${fmt(entry.after)} → ${fmt(entry.before)}`)
        break
      }
    }
  }
  console.log(`\nRestored ${restored} of ${entries.length} places from ${journalPath}.`)
  if (restored !== entries.length) {
    console.error('Some rows were not found — check --trip, and do not re-run blindly.')
    process.exitCode = 1
  }
}

const fmt = (c: { lat: number | null; lng: number | null }) =>
  c.lat === null || c.lng === null ? 'no location' : `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`

/**
 * One run. `argv` is a parameter rather than a read of `process.argv` so the
 * whole cycle — dry, apply, apply again, revert — can be rehearsed in a single
 * process against the memory store, which resets on restart and could
 * otherwise never demonstrate that a re-run skips what it already located.
 */
export async function main(argv: string[] = process.argv.slice(2)) {
  const journalToRevert = arg(argv, '--revert')
  if (journalToRevert) return revert(journalToRevert, argv)
  if (journalToRevert === '') {
    console.error('--revert needs a journal path (scripts/.backfill/<timestamp>.json)')
    process.exit(1)
  }

  const apply = argv.includes('--apply')
  const { getDataStore } = await import('../server/src/lib/datastore')
  const { resolvePlaceLocation } = await import('../server/src/services/geocode')
  const store = await getDataStore()

  console.log(apply ? 'Applying — every write is journalled.' : 'Dry run — nothing is written.')

  const journal: JournalEntry[] = []
  const unresolved: string[] = []
  let resolved = 0
  let skipped = 0

  for (const tripId of tripIds(argv)) {
    const zones = await store.listZones(tripId)
    const near = new Map(
      zones
        .filter((z) => typeof z.lat === 'number' && typeof z.lng === 'number')
        .map((z) => [z.id, { lat: z.lat as number, lng: z.lng as number }])
    )

    for (const place of await store.listActivities(tripId)) {
      if (typeof place.lat === 'number' && typeof place.lng === 'number') {
        skipped += 1
        console.log(`· ${place.name}: already located, skipped`)
        continue
      }

      const hit = await resolvePlaceLocation({
        name: place.name,
        address: place.address,
        // An activity may have no city (a dated one need not); with nothing
        // to bias the search towards, the lookup falls back to a global one.
        near: place.zone_id ? near.get(place.zone_id) : undefined,
      })
      // The wait belongs to the lookup: a run over already-located places
      // costs nothing, which is what makes a resumed run quick.
      await sleep(RATE_LIMIT_MS)

      if (!hit) {
        unresolved.push(place.name)
        console.log(`✗ ${place.name}: nothing matched`)
        continue
      }

      resolved += 1
      console.log(`✓ ${place.name} → ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)} (${hit.name})`)
      if (!apply) continue

      const before = { lat: place.lat ?? null, lng: place.lng ?? null }
      const after = { lat: hit.lat, lng: hit.lng }
      const written = await store.updateActivity(tripId, place.id, after)
      if (!written) {
        console.error(`  ! ${place.name}: the write found no row — not journalled`)
        continue
      }
      journal.push({ id: place.id, name: place.name, before, after })
    }
  }

  console.log(
    `\n${resolved} resolved · ${skipped} already located · ${unresolved.length} not found`
  )
  if (unresolved.length) {
    // By name, never as a count: a place nobody can name is a place nobody
    // will fix, and it would be indistinguishable from one never tried (FR-002).
    console.log('\nCould not resolve — set these by hand on the place screen:')
    for (const name of unresolved) console.log(`  · ${name}`)
  }

  if (apply && journal.length) {
    mkdirSync(JOURNAL_DIR, { recursive: true })
    const file = path.join(JOURNAL_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(file, `${JSON.stringify(journal, null, 2)}\n`)
    console.log(`\nJournal: ${file}`)
    console.log(`Undo the whole batch with:\n  npm run backfill:coords -- --revert ${file}`)
  } else if (!apply) {
    console.log('\nNothing was written. Re-run with --apply to store these.')
  }
}

// Only when this file is what was run: importing it (the rehearsal in
// quickstart §A1) must not start a run of its own.
if (process.argv[1]?.includes('backfill-coords')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
