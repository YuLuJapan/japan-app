// Seed the Supabase database from server/src/data/placeholder-data.json.
// Idempotent: upserts by primary key, so re-running syncs the current file.
// Usage: DATA_BACKEND=supabase in .env.local, then `npm run seed`.
// FK-safe order: trips → zones → journey_steps → places → tips → files.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadEnv } from './loadEnv'

loadEnv()

async function main() {
  const { getSupabase } = await import('../server/src/lib/supabase')
  const db = getSupabase()

  const dataPath = path.join(process.cwd(), 'server/src/data/placeholder-data.json')
  const data = JSON.parse(readFileSync(dataPath, 'utf-8'))

  const steps: [string, unknown[]][] = [
    ['trips', [data.trip]],
    ['zones', data.zones],
    ['journey_steps', data.steps],
    ['places', data.places],
    ['tips', data.tips],
    ['itinerary_items', data.itinerary ?? []],
    ['files', data.files],
  ]

  for (const [table, rows] of steps) {
    if (!rows.length) {
      console.log(`- ${table}: nothing to seed`)
      continue
    }
    const { error } = await db.from(table).upsert(rows as never, { onConflict: 'id' })
    if (error) {
      console.error(`✗ ${table}: ${error.message}`)
      process.exit(1)
    }
    console.log(`✓ ${table}: ${rows.length} rows`)
  }
  console.log('\nDone. File blobs are uploaded separately with `npm run seed:files`.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
