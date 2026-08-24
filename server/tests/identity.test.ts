// lib/identity.ts — who the caller is, said without reference to what they may
// do. The split matters: an account can verify perfectly and still be granted
// nothing, and these cases pin that apart from the authorization in lib/auth.ts.
//
// The verifier here is the real one. `resolveUser` takes it as an argument, so
// the cases below wrap `resolveAuthUser` in a counting spy rather than
// replacing it: every "verified" in this file means a token that a real GoTrue
// really accepted, and every call count is a round trip that really happened.
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { CURRENT_TERMS_VERSION } from '../src/lib/terms.js'
import { getDataStore } from '../src/lib/datastore.js'
import { resolveUser, syncProfile } from '../src/lib/identity.js'
import { resolveAuthUser } from '../src/lib/supabaseAuth.js'
import { withTableMissing } from '../testing/db.js'
import { OWNER_USER, PARTNER_USER } from '../testing/accounts.js'
import { tokenFor } from './auth.js'

const app = createApp()
const ownerToken = tokenFor(OWNER_USER)
const signedIn = { Authorization: `Bearer ${ownerToken}` }

/** The real verifier, counted. Nothing about its answers is arranged. */
const counted = () => vi.fn(resolveAuthUser)

/** What `resolveAuthUser` reads out of the owner's token. */
const ownerIdentity = {
  id: OWNER_USER.id,
  email: OWNER_USER.email,
  email_confirmed: true,
  display_name: OWNER_USER.display_name,
  avatar_url: OWNER_USER.avatar_url,
}

describe('resolveUser', () => {
  it('resolves a verified JWT to the account behind it', async () => {
    expect(await resolveUser(ownerToken, counted())).toEqual(ownerIdentity)
  })

  it('returns null for an empty or unverifiable token', async () => {
    const verify = counted()
    expect(await resolveUser('', verify)).toBeNull()
    expect(await resolveUser('garbage', verify)).toBeNull()
    // The empty token short-circuits before the verifier is ever reached.
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('resolves any account — reaching a trip is a separate question', async () => {
    // Identity says nothing about authorization: the owner of another trip
    // resolves perfectly well here and then reaches none of this one
    // (see membership.test.ts).
    const stranger = await resolveUser(tokenFor(PARTNER_USER), counted())
    expect(stranger).toMatchObject({ id: PARTNER_USER.id, email: PARTNER_USER.email })
  })

  // There is no non-account way in any more. The shared codes used to be
  // checked here, ahead of the verifier, and resolved to "every trip".
  it('has no path that bypasses the verifier', async () => {
    const verify = counted()
    for (const token of ['japan2026', 'test-code', 'guest-code']) {
      expect(await resolveUser(token, verify)).toBeNull()
    }
    expect(verify).toHaveBeenCalledTimes(3)
  })
})

describe('token cache', () => {
  it('verifies a token once and serves repeats from cache', async () => {
    const verify = counted()
    await resolveUser(ownerToken, verify)
    await resolveUser(ownerToken, verify)
    await resolveUser(ownerToken, verify)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('caches rejections too, so a dead token cannot hammer Supabase', async () => {
    const verify = counted()
    await resolveUser('dead.jwt', verify)
    await resolveUser('dead.jwt', verify)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('keeps distinct tokens apart', async () => {
    const verify = counted()
    const first = await resolveUser(ownerToken, verify)
    const second = await resolveUser(tokenFor(PARTNER_USER), verify)
    expect(first).not.toEqual(second)
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('expires entries so a revoked token stops working', async () => {
    // Only Date is faked: the verifier makes a real HTTP call, and faking the
    // timers it runs on would deadlock it.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const verify = counted()
      await resolveUser(ownerToken, verify)
      vi.advanceTimersByTime(61_000)
      await resolveUser(ownerToken, verify)
      // Past the TTL the cached answer is not reused — the token is checked
      // with Supabase again, which is what lets a revoked one stop working.
      expect(verify).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('profile sync', () => {
  it('records the signed-in account on first authenticated request', async () => {
    await request(app).get('/api/trips/trip-1').set(signedIn).expect(200)

    const profile = await (await getDataStore()).getProfile(OWNER_USER.id)
    expect(profile).toMatchObject({
      id: OWNER_USER.id,
      email: OWNER_USER.email,
      display_name: OWNER_USER.display_name,
      // Refreshed from the token: the fixture row carries no avatar.
      avatar_url: OWNER_USER.avatar_url,
    })
  })

  it('writes once per user per window, not once per request', async () => {
    const store = await getDataStore()
    // A spy that still calls through — this counts writes, it does not stage them.
    const upsert = vi.spyOn(store, 'upsertProfile')

    for (let i = 0; i < 3; i++) {
      await request(app).get('/api/trips/trip-1').set(signedIn).expect(200)
    }
    expect(upsert).toHaveBeenCalledTimes(1)
    upsert.mockRestore()
  })

  it('never fails the request when the profiles table is unavailable', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The table is really gone for the duration, so the store fails the way an
    // unmigrated project fails rather than the way a stub would.
    await withTableMissing('profiles', async () => {
      // The whole point: an unmigrated database degrades to "no profile row",
      // not to a 500 on every authenticated call.
      await request(app).get('/api/trips/trip-1').set(signedIn).expect(200)
    })

    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })

  it('does not blank a stored name when the provider sends none', async () => {
    const store = await getDataStore()
    await syncProfile(store, { ...ownerIdentity, display_name: null, avatar_url: null })

    expect((await store.getProfile(OWNER_USER.id))?.display_name).toBe(OWNER_USER.display_name)
  })
})

describe('GET /api/me', () => {
  it('names the signed-in account', async () => {
    const res = await request(app).get('/api/me').set(signedIn)
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({
      id: OWNER_USER.id,
      email: OWNER_USER.email,
      display_name: OWNER_USER.display_name,
      avatar_url: OWNER_USER.avatar_url,
    })
    // A fixture account has never accepted anything, so the app asks.
    expect(res.body.terms).toEqual({ accepted: false, version: CURRENT_TERMS_VERSION })
  })

  it('requires authentication like every other route', async () => {
    await request(app).get('/api/me').expect(401)
    await request(app).get('/api/me').set({ Authorization: 'Bearer not-a-real-token' }).expect(401)
  })
})
