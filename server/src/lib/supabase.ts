// Supabase server client — uses the service-role key, so it bypasses RLS and is
// the ONLY thing that can read/write the database. Server-side only; the key is
// never shipped to the browser. Used when DATA_BACKEND=supabase (Phase 8).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (client) return client
  const url = process.env.SUPABASE_URL
  // New Supabase API keys use SUPABASE_SECRET_KEY (sb_secret_...); fall back to
  // the legacy service-role env name for older projects.
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set to use DATA_BACKEND=supabase')
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}

export const FILES_BUCKET = 'trip-files'
