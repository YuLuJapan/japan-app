// Upload file blobs to the Supabase `trip-files` bucket. Each file row in
// placeholder-data.json has a storage_path (e.g. "placeholder-files/x.pdf");
// this uploads the matching local file from public/<storage_path> to that key.
// Replace the local sample files with the real documents, keep the paths, re-run.
// Usage: DATA_BACKEND=supabase in .env.local, then `npm run seed:files`.
import { loadEnv } from './loadEnv'
import { seedBlobs } from './seed-lib'

loadEnv()

async function main() {
  const { getSupabase, FILES_BUCKET } = await import('../server/src/lib/supabase')
  await seedBlobs(getSupabase(), FILES_BUCKET)
  console.log('\nDone. Update file size_bytes in the data file if you swapped in larger files.')
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
