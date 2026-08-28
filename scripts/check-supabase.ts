// Read-only Supabase diagnostic: verifies the connection, that each table from
// the migration exists, and that the `trip-files` bucket is present. Prints no
// secrets. Usage: `npx tsx scripts/check-supabase.ts` (reads .env.local).
import { loadEnv } from './loadEnv'

loadEnv()

const TABLES = ['trips', 'zones', 'journey_steps', 'places', 'tips', 'files']

async function main() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY
  console.log('DATA_BACKEND      =', process.env.DATA_BACKEND ?? '(unset)')
  console.log('SUPABASE_URL      =', process.env.SUPABASE_URL ? 'set ✓' : 'MISSING ✗')
  console.log('SUPABASE_SECRET_KEY =', key ? 'set ✓' : 'MISSING ✗')
  if (!process.env.SUPABASE_URL || !key) {
    console.error('\nAdd both to .env.local, then re-run.')
    process.exit(1)
  }

  const { getSupabase, FILES_BUCKET } = await import('../server/src/lib/supabase')
  const db = getSupabase()

  console.log('\nTables:')
  let missing = 0
  for (const t of TABLES) {
    const { count, error } = await db.from(t).select('id', { count: 'exact', head: true })
    if (error) {
      missing++
      console.log(`  ✗ ${t.padEnd(14)} ${error.message}`)
    } else {
      console.log(`  ✓ ${t.padEnd(14)} ${count ?? 0} rows`)
    }
  }

  console.log('\nStorage:')
  const { data: buckets, error: bErr } = await db.storage.listBuckets()
  if (bErr) {
    console.log(`  ✗ could not list buckets: ${bErr.message}`)
  } else {
    const found = buckets?.some((b) => b.name === FILES_BUCKET)
    console.log(
      found ? `  ✓ bucket "${FILES_BUCKET}" exists` : `  ✗ bucket "${FILES_BUCKET}" MISSING`
    )
  }

  console.log(
    missing === 0
      ? '\nSchema looks good. Next: `npm run seed` then `npm run seed:files`.'
      : `\n${missing} table(s) missing — run supabase/migrations/0001_init.sql in the Supabase SQL editor first.`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
