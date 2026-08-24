// The accounts tests sign in as — real GoTrue users, with real passwords, and
// real JWTs obtained by actually signing in.
//
// This replaces `setTokenVerifier`. That hook let a test say "this token is
// Yuval" without a Supabase project to say it to, which meant the one thing it
// could never check was whether `resolveAuthUser` reads a real token
// correctly. With Auth in the stack there is nothing left to stand in for.
import { unconfirmEmail, type SqlRunner } from './schema.js'
import { SERVICE_KEY, TEST_PASSWORD } from './stack-config.js'

/**
 * `profiles.id`, `trip_members.user_id` and friends are `uuid` columns, so
 * these are UUIDs rather than the readable ids the memory store used to
 * accept — the ordinal at the end is what keeps them legible in a failure.
 */
export interface TestAccount {
  id: string
  email: string
  display_name: string
  /**
   * What the identity provider vouches for, which is not the same as what the
   * app has stored. Only the owner has one, so "the profile row gets its
   * avatar from the token" is a claim with somewhere to be false.
   */
  avatar_url: string | null
  /** False once provisioning finishes: signed in, but never confirmed the address. */
  confirmed: boolean
}

const account = (
  n: number,
  email: string,
  display_name: string,
  { confirmed = true, avatar_url = null as string | null } = {}
): TestAccount => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  email,
  display_name,
  avatar_url,
  confirmed,
})

/** The owner of trip-1 — the account most tests act as. */
export const OWNER_USER = account(1, 'yuval@example.com', 'Yuval', {
  avatar_url: 'https://example.com/y.png',
})
/** The owner of trip-2: a second tenant, so cross-trip leaks have something to leak into. */
export const PARTNER_USER = account(2, 'sam@example.com', 'Sam')
/** A friend a trip is shared with, read-only. Visibility is set per test. */
export const VIEWER_USER = account(3, 'friend@example.com', 'Friend')
/** A valid account that is a member of nothing — the shape every new signup arrives in. */
export const OUTSIDER_USER = account(4, 'outsider@example.com', 'Outsider')
/**
 * Signed in, but the address was never confirmed.
 *
 * A separate account rather than a second token for the outsider, because an
 * address is confirmed or it isn't — GoTrue will not hold both opinions about
 * one user. What the tests need is an account whose *own* address is
 * unconfirmed, so an invitation addressed to it is still unclaimable.
 */
export const UNCONFIRMED_USER = account(5, 'unconfirmed@example.com', 'Unconfirmed', {
  confirmed: false,
})

export const TEST_ACCOUNTS: TestAccount[] = [
  OWNER_USER,
  PARTNER_USER,
  VIEWER_USER,
  OUTSIDER_USER,
  UNCONFIRMED_USER,
]

const adminHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

async function createUser(url: string, user: TestAccount): Promise<void> {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      id: user.id,
      email: user.email,
      password: TEST_PASSWORD,
      // Always created confirmed: GoTrue refuses to issue a token otherwise,
      // and a token is exactly what the unconfirmed case needs to hold.
      email_confirm: true,
      user_metadata: { name: user.display_name, avatar_url: user.avatar_url },
    }),
  })
  // 422 is "this account already exists", which is the normal answer when a
  // stack is reused across runs. Anything else is a real failure.
  if (!res.ok && res.status !== 422) {
    throw new Error(`creating ${user.email} failed: HTTP ${res.status} ${await res.text()}`)
  }
  if (res.status === 422) await confirmEmail(url, user)
}

/** Puts a reused account back into a signable state before we ask for a token. */
async function confirmEmail(url: string, user: TestAccount): Promise<void> {
  await fetch(`${url}/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ email_confirm: true }),
  })
}

async function signIn(url: string, user: TestAccount): Promise<string> {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ email: user.email, password: TEST_PASSWORD }),
  })
  if (!res.ok) {
    throw new Error(`signing in ${user.email} failed: HTTP ${res.status} ${await res.text()}`)
  }
  const body = (await res.json()) as { access_token?: string }
  if (!body.access_token) throw new Error(`no access token for ${user.email}`)
  return body.access_token
}

/**
 * Creates every test account and signs each one in, returning email → token.
 *
 * Done once per run rather than per test: accounts live in GoTrue's schema,
 * which `resetData` deliberately leaves alone, and signing in five times per
 * test would dominate the run.
 */
export async function provisionAccounts(
  url: string,
  pool: SqlRunner
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {}
  for (const user of TEST_ACCOUNTS) {
    await createUser(url, user)
    tokens[user.email] = await signIn(url, user)
    // Withdraw the confirmation *after* the token exists — the order a real
    // person would arrive in, and the only order that yields this token at all.
    if (!user.confirmed) await unconfirmEmail(pool, user.id)
  }
  return tokens
}
