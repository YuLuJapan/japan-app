// Browser-side Supabase client, used only for owner sign-in (email
// magic-link). Returns null when VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY
// aren't configured — magic-link then simply isn't offered; the access-code
// path (AccessGate's "Use an access code instead") still works either way.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// undefined = not yet resolved, null = resolved to "not configured".
let client: SupabaseClient | null | undefined

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  client = url && key ? createClient(url, key) : null
  return client
}
