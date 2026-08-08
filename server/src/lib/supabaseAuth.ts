// Verifies Supabase Auth JWTs for owner sign-in (email magic-link). Separate
// from lib/supabase.ts (the secret-key client used for DATA_BACKEND=supabase)
// — this only ever calls the Auth API's getUser, which needs no elevated
// privileges, so it uses the publishable key and works regardless of which
// DATA_BACKEND is configured (auth is a property of the Supabase project, not
// of the data store).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// undefined = not yet resolved, null = resolved to "not configured".
let client: SupabaseClient | null | undefined

function getAuthClient(): SupabaseClient | null {
  if (client !== undefined) return client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
  client =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      : null
  return client
}

/**
 * Verifies a Supabase Auth JWT and returns the signed-in user's email, or
 * null when the token doesn't verify (expired, malformed, wrong project) or
 * Supabase Auth isn't configured (`SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`
 * unset) — magic-link sign-in simply isn't available then, same graceful
 * degradation as push.ts with no VAPID keys.
 */
export async function resolveOwnerEmail(token: string): Promise<string | null> {
  const supabase = getAuthClient()
  if (!supabase) return null
  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user?.email) return null
    return data.user.email
  } catch {
    // Network hiccup talking to Supabase Auth: treat as "not an owner" rather
    // than failing the request — the static access codes still work.
    return null
  }
}
