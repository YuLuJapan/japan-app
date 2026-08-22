// Verifies Supabase Auth JWTs for account sign-in (Google OAuth, email +
// password, magic-link). Separate from lib/supabase.ts (the secret-key client
// used for DATA_BACKEND=supabase) — this only ever calls the Auth API's
// getUser, which needs no elevated privileges, so it uses the publishable key
// and works regardless of which DATA_BACKEND is configured (auth is a property
// of the Supabase project, not of the data store).
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

/** The signed-in account behind a verified token. */
export interface AuthUser {
  id: string
  email: string
  /**
   * Whether Supabase has confirmed the address — the account clicked a link
   * sent to it, or an OAuth provider vouched for it.
   *
   * Load-bearing exactly once: an invitation addressed to an email is claimed
   * by matching it, so an unconfirmed address must not be able to claim one.
   * Anyone can *type* someone else's address at sign-up.
   */
  email_confirmed: boolean
  display_name: string | null
  avatar_url: string | null
}

/**
 * Google hands back `name`/`full_name` and `avatar_url`/`picture` in
 * user_metadata; email+password sign-up has neither. Nulls here are meaningful
 * — the profile upsert leaves an existing value alone rather than blanking it.
 */
function readMetadata(meta: Record<string, unknown> | undefined) {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = meta?.[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
  }
  return {
    display_name: pick('name', 'full_name', 'display_name'),
    avatar_url: pick('avatar_url', 'picture'),
  }
}

/**
 * Verifies a Supabase Auth JWT and returns the signed-in account, or null when
 * the token doesn't verify (expired, malformed, wrong project) or Supabase Auth
 * isn't configured (`SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` unset) — account
 * sign-in simply isn't available then, the same graceful degradation as push.ts
 * with no VAPID keys.
 */
export async function resolveAuthUser(token: string): Promise<AuthUser | null> {
  const supabase = getAuthClient()
  if (!supabase) return null
  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user?.email) return null
    return {
      id: data.user.id,
      email: data.user.email,
      // Absent on an account created while confirmations were switched off.
      // Treated as unconfirmed, which is the safe direction: it costs a
      // confirmation email, it does not hand anyone someone else's trip.
      email_confirmed: Boolean(data.user.email_confirmed_at),
      ...readMetadata(data.user.user_metadata as Record<string, unknown> | undefined),
    }
  } catch {
    // Network hiccup talking to Supabase Auth: treat as "not signed in" rather
    // than failing the request — the static access codes still work.
    return null
  }
}
