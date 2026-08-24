// Signing in, in tests — for real.
//
// This used to hand `lib/identity.ts` a fake verifier that mapped the string
// 'owner.jwt' to an account. Convenient, and it meant `resolveAuthUser` — the
// code that actually decides who a caller is — ran in no test at all.
//
// Now the tokens below are issued by the GoTrue in the test stack, in exchange
// for a real password, and the app verifies them by asking that same GoTrue.
// The only thing tests know is which token belongs to whom.
import request from 'supertest'
import { inject } from 'vitest'
import {
  OUTSIDER_USER,
  OWNER_USER,
  PARTNER_USER,
  UNCONFIRMED_USER,
  VIEWER_USER,
  type TestAccount,
} from '../testing/accounts.js'

export { OUTSIDER_USER, OWNER_USER, PARTNER_USER, UNCONFIRMED_USER, VIEWER_USER, type TestAccount }

/** email → JWT, minted once per run by `provisionAccounts`. */
const tokens = inject('authTokens')

/** The bearer token for an account, for the odd caller that builds its own request. */
export function tokenFor(user: TestAccount): string {
  const token = tokens[user.email]
  if (!token) throw new Error(`no token was provisioned for ${user.email}`)
  return token
}

export const OWNER_BEARER = { Authorization: `Bearer ${tokenFor(OWNER_USER)}` }

const bearer = (user: TestAccount) => (r: request.Test) =>
  r.set('Authorization', `Bearer ${tokenFor(user)}`)

/** `await asOwner(request(app).get('/api/…'))` — the trip-1 owner. */
export const asOwner = bearer(OWNER_USER)
/** The owner of trip-2: the second tenant, for "does not leak across trips". */
export const asPartner = bearer(PARTNER_USER)
/** A read-only member of whatever the test made them a member of. */
export const asViewer = bearer(VIEWER_USER)
/** A valid account that is a member of nothing — the shape every signup arrives in. */
export const asOutsider = bearer(OUTSIDER_USER)
/** Signed in, but never confirmed the address it claims. */
export const asUnconfirmed = bearer(UNCONFIRMED_USER)
