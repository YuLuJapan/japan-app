// Signing in, in tests.
//
// Every API test needs a bearer token that resolves to somebody. Rather than
// mocking `supabaseAuth.js` in each file, hand `lib/identity.ts` a verifier
// that reads this table — the same seam `setDataStore` provides for the
// datastore, and one that keeps the token → account mapping in one place.
import request from 'supertest'
import { setTokenVerifier } from '../src/lib/identity.js'
import { OUTSIDER_USER, OWNER_USER, PARTNER_USER, VIEWER_USER } from './fixture.js'

/** Token → account. Anything else is an invalid token, i.e. a 401. */
export const TOKENS = {
  'owner.jwt': OWNER_USER,
  'partner.jwt': PARTNER_USER,
  'viewer.jwt': VIEWER_USER,
  'outsider.jwt': OUTSIDER_USER,
}

/** Call in `beforeEach`, alongside `setDataStore`. */
export function useTestTokens(): void {
  setTokenVerifier(async (token) => TOKENS[token as keyof typeof TOKENS] ?? null)
}

const bearer = (token: string) => (r: request.Test) => r.set('Authorization', `Bearer ${token}`)

/** `await asOwner(request(app).get('/api/…'))` — the trip-1 owner. */
export const asOwner = bearer('owner.jwt')
/** The owner of trip-2: the second tenant, for "does not leak across trips". */
export const asPartner = bearer('partner.jwt')
/** A read-only member of whatever the test made them a member of. */
export const asViewer = bearer('viewer.jwt')
/** A valid account that is a member of nothing — the shape every signup arrives in. */
export const asOutsider = bearer('outsider.jwt')
