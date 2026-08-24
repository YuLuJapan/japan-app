// Seed the Supabase database from server/src/data/placeholder-data.json.
// Idempotent: upserts by primary key, so re-running syncs the current file.
// Usage: DATA_BACKEND=supabase in .env.local, then `npm run seed`.
//
// The rows themselves live in scripts/seed-lib.ts, shared with the local stack
// (`npm run local:up`) so both fill a database the same way.
import { loadEnv } from './loadEnv'
import { seedRows } from './seed-lib'

loadEnv()

async function main() {
  const { getSupabase } = await import('../server/src/lib/supabase')
  await seedRows(getSupabase())
  console.log('\nDone. File blobs are uploaded separately with `npm run seed:files`.')
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
