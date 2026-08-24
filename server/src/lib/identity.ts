// Identity: *who* is making this request. Deliberately says nothing about what
// they may do — that is lib/auth.ts for the door and per-trip membership for
// everything past it. Keeping the two apart is the point: authMiddleware used
// to answer both questions at once, which is why every new route had to be
// guarded by hand.
//
// There is now exactly one way to be somebody: a Supabase Auth JWT. The shared
// access codes are gone. They were a single credential that reached every trip
// in the database, which stopped being defensible the moment trips belonged to
// people — no per-trip membership can constrain a caller who is not a person.
// Anyone the travellers used to hand a code to is now invited as a viewer,
// with per-member visibility instead of one fixed narrow view.
import type { DataStore } from './datastore.js'
import { resolveAuthUser, type AuthUser } from './supabaseAuth.js'

export type { AuthUser }

/** Swappable so tests never need a Supabase project — same idiom as `PushSender`. */
export type TokenVerifier = (token: string) => Promise<AuthUser | null>

// --- token cache -------------------------------------------------------------
// Verifying a JWT is an HTTPS round-trip to Supabase Auth. Without this, every
// single API call pays for one. Vercel keeps functions warm between requests,
// so the hit rate is high in practice.
//
// Failures are cached too, briefly: otherwise a client stuck retrying with a
// dead token turns into sustained traffic against Supabase Auth.
const TOKEN_TTL_MS = 60_000
const FAILURE_TTL_MS = 10_000
const MAX_ENTRIES = 500

interface CacheEntry {
  at: number
  ttl: number
  user: AuthUser | null
}

const tokenCache = new Map<string, CacheEntry>()

function cacheGet(token: string): CacheEntry | undefined {
  const hit = tokenCache.get(token)
  if (!hit) return undefined
  if (Date.now() - hit.at > hit.ttl) {
    tokenCache.delete(token)
    return undefined
  }
  return hit
}

function cacheSet(token: string, user: AuthUser | null): void {
  // Crude bound: once full, drop the oldest insertion. Map preserves insertion
  // order, so this is FIFO rather than LRU — good enough for a cache whose
  // entries expire in a minute anyway.
  if (tokenCache.size >= MAX_ENTRIES) {
    const oldest = tokenCache.keys().next()
    if (!oldest.done) tokenCache.delete(oldest.value)
  }
  tokenCache.set(token, { at: Date.now(), ttl: user ? TOKEN_TTL_MS : FAILURE_TTL_MS, user })
}

/** Test hook — the cache is process-wide, so it has to be clearable between cases. */
export function clearTokenCache(): void {
  tokenCache.clear()
  syncedProfiles.clear()
}

// --- resolution --------------------------------------------------------------

/**
 * Who a bearer token proves the caller to be, or null when it proves nothing.
 *
 * Says nothing about authorization: a brand-new account nobody has invited
 * anywhere resolves perfectly well here and then sees an empty trip list.
 */
export async function resolveUser(
  token: string,
  verify: TokenVerifier = resolveAuthUser
): Promise<AuthUser | null> {
  if (!token) return null
  const cached = cacheGet(token)
  if (cached) return cached.user
  const user = await verify(token)
  cacheSet(token, user)
  return user
}

// --- profile sync ------------------------------------------------------------
// One upsert per user per window, not per request.
const PROFILE_TTL_MS = 5 * 60_000
const syncedProfiles = new Map<string, number>()

/**
 * Records the signed-in account in `profiles` so the rest of the app can join
 * against it (the members list in phase 4, the auto-title's fallback name in
 * phase 5) without reaching into Supabase's `auth` schema.
 *
 * **Never fails a request.** A profile row is bookkeeping; the caller has
 * already proved who they are. If the table isn't migrated yet, or Postgres is
 * having a moment, the request carries on and the next one retries — the same
 * graceful degradation the Supabase store applies to not-yet-migrated columns.
 */
export async function syncProfile(store: DataStore, user: AuthUser): Promise<void> {
  const last = syncedProfiles.get(user.id)
  if (last && Date.now() - last < PROFILE_TTL_MS) return
  try {
    await store.upsertProfile({
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
    })
    syncedProfiles.set(user.id, Date.now())
  } catch (err) {
    console.error('profile sync failed (continuing):', err)
  }
}
