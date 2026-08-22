// Signing in, in tests.
//
// Every API test needs a bearer token that resolves to somebody. Rather than
// mocking `supabaseAuth.js` in each file, hand `lib/identity.ts` a verifier
// that reads this table — the same seam `setDataStore` provides for the
// datastore, and one that keeps the token → account mapping in one place.
import request from 'supertest'
import { setTokenVerifier, type AuthUser } from '../src/lib/identity.js'
import { OUTSIDER_USER, OWNER_USER, PARTNER_USER, VIEWER_USER } from './fixture.js'

/** A fixture profile as the token would present it: confirmed unless said otherwise. */
const signedIn = (
  profile: Omit<AuthUser, 'email_confirmed'>,
  email_confirmed = true
): AuthUser => ({
  ...profile,
  email_confirmed,
})

/** Token → account. Anything else is an invalid token, i.e. a 401. */
export const TOKENS: Record<string, AuthUser> = {
  'owner.jwt': signedIn(OWNER_USER),
  'partner.jwt': signedIn(PARTNER_USER),
  'viewer.jwt': signedIn(VIEWER_USER),
  'outsider.jwt': signedIn(OUTSIDER_USER),
  // Same account as outsider.jwt, signed in before confirming the address.
  // Anyone can type someone else's email at sign-up, so this token must not
  // be able to claim an invitation addressed to it.
  'unconfirmed.jwt': signedIn(OUTSIDER_USER, false),
}

/** Call in `beforeEach`, alongside `setDataStore`. */
export function useTestTokens(): void {
  setTokenVerifier(async (token) => TOKENS[token] ?? null)
}

/** For the odd call that builds its own request and wants a header object. */
export const OWNER_BEARER = { Authorization: 'Bearer owner.jwt' }

const bearer = (token: string) => (r: request.Test) => r.set('Authorization', `Bearer ${token}`)

/** `await asOwner(request(app).get('/api/…'))` — the trip-1 owner. */
export const asOwner = bearer('owner.jwt')
/** The owner of trip-2: the second tenant, for "does not leak across trips". */
export const asPartner = bearer('partner.jwt')
/** A read-only member of whatever the test made them a member of. */
export const asViewer = bearer('viewer.jwt')
/** A valid account that is a member of nothing — the shape every signup arrives in. */
export const asOutsider = bearer('outsider.jwt')
/** The same account, before it confirmed its email address. */
export const asUnconfirmed = bearer('unconfirmed.jwt')
