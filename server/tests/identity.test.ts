// lib/identity.ts — who the caller is, said without reference to what they may
// do. The split matters: an account can verify perfectly and still be granted
// nothing, and these cases pin that apart from the authorization in lib/auth.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { getDataStore, setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { clearTokenCache, resolveUser, setTokenVerifier, syncProfile } from '../src/lib/identity.js'
import { fixture } from './fixture.js'

// Matches OWNER_USER in the fixture, which holds the membership on trip-1 —
// /api/trips/trip-1 is scoped to the caller's trips now, so an account with none
// would 404 here for reasons that have nothing to do with identity.
const GOOGLE_USER = {
  id: 'user-yuval',
  email: 'yuval@example.com',
  display_name: 'Yuval',
  avatar_url: 'https://example.com/y.png',
}

const app = createApp()
const signedIn = { Authorization: 'Bearer a.jwt' }

/** Every request in this file resolves to GOOGLE_USER unless a case says otherwise. */
const acceptAnyToken = () => setTokenVerifier(async () => GOOGLE_USER)

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  clearTokenCache()
  acceptAnyToken()
})

describe('resolveUser', () => {
  it('resolves a verified JWT to the account behind it', async () => {
    const verify = vi.fn().mockResolvedValue(GOOGLE_USER)
    expect(await resolveUser('a.jwt', verify)).toEqual(GOOGLE_USER)
  })

  it('returns null for an empty or unverifiable token', async () => {
    const verify = vi.fn().mockResolvedValue(null)
    expect(await resolveUser('', verify)).toBeNull()
    expect(await resolveUser('garbage', verify)).toBeNull()
    // The empty token short-circuits before the verifier is ever reached.
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('resolves any account — reaching a trip is a separate question', async () => {
    // Identity says nothing about authorization: a stranger resolves perfectly
    // well and then reaches no trip at all (see membership.test.ts).
    const stranger = { ...GOOGLE_USER, id: 'user-stranger', email: 'stranger@example.com' }
    const verify = vi.fn().mockResolvedValue(stranger)
    expect(await resolveUser('a.jwt', verify)).toEqual(stranger)
  })

  // There is no non-account way in any more. The shared codes used to be
  // checked here, ahead of the verifier, and resolved to "every trip".
  it('has no path that bypasses the verifier', async () => {
    const verify = vi.fn().mockResolvedValue(null)
    for (const token of ['japan2026', 'test-code', 'guest-code']) {
      expect(await resolveUser(token, verify)).toBeNull()
    }
    expect(verify).toHaveBeenCalledTimes(3)
  })
})

describe('token cache', () => {
  it('verifies a token once and serves repeats from cache', async () => {
    const verify = vi.fn().mockResolvedValue(GOOGLE_USER)
    await resolveUser('a.jwt', verify)
    await resolveUser('a.jwt', verify)
    await resolveUser('a.jwt', verify)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('caches rejections too, so a dead token cannot hammer Supabase', async () => {
    const verify = vi.fn().mockResolvedValue(null)
    await resolveUser('dead.jwt', verify)
    await resolveUser('dead.jwt', verify)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('keeps distinct tokens apart', async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce(GOOGLE_USER)
      .mockResolvedValueOnce({ ...GOOGLE_USER, id: 'user-luciana' })
    const first = await resolveUser('one.jwt', verify)
    const second = await resolveUser('two.jwt', verify)
    expect(first).not.toEqual(second)
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('expires entries so a revoked token stops working', async () => {
    vi.useFakeTimers()
    try {
      const verify = vi.fn().mockResolvedValue(GOOGLE_USER)
      await resolveUser('a.jwt', verify)
      vi.advanceTimersByTime(61_000)
      verify.mockResolvedValue(null)
      expect(await resolveUser('a.jwt', verify)).toBeNull()
      expect(verify).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('profile sync', () => {
  it('records the signed-in account on first authenticated request', async () => {
    await request(app).get('/api/trips/trip-1').set(signedIn).expect(200)

    const profile = await (await getDataStore()).getProfile('user-yuval')
    expect(profile).toEqual({
      id: 'user-yuval',
      email: 'yuval@example.com',
      display_name: 'Yuval',
      // Refreshed from the token: the fixture row carries no avatar.
      avatar_url: 'https://example.com/y.png',
    })
  })

  it('writes once per user per window, not once per request', async () => {
    const store = createMemoryStore(fixture())
    const upsert = vi.spyOn(store, 'upsertProfile')
    setDataStore(store)

    for (let i = 0; i < 3; i++) {
      await request(app).get('/api/trips/trip-1').set(signedIn).expect(200)
    }
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('never fails the request when the profiles table is unavailable', async () => {
    const store = createMemoryStore(fixture())
    store.upsertProfile = () => Promise.reject(new Error('relation "profiles" does not exist'))
    setDataStore(store)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The whole point: an unmigrated database degrades to "no profile row",
    // not to a 500 on every authenticated call.
    await request(app).get('/api/trips/trip-1').set(signedIn).expect(200)
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })

  it('does not blank a stored name when the provider sends none', async () => {
    const store: DataStore = createMemoryStore(fixture())
    await store.upsertProfile({
      id: 'user-yuval',
      email: 'yuval@example.com',
      display_name: 'Yuval',
    })
    await syncProfile(store, { ...GOOGLE_USER, display_name: null, avatar_url: null })

    expect((await store.getProfile('user-yuval'))?.display_name).toBe('Yuval')
  })
})

describe('GET /api/me', () => {
  it('names the signed-in account', async () => {
    const res = await request(app).get('/api/me').set(signedIn)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      user: {
        id: 'user-yuval',
        email: 'yuval@example.com',
        display_name: 'Yuval',
        avatar_url: 'https://example.com/y.png',
      },
    })
  })

  it('requires authentication like every other route', async () => {
    setTokenVerifier(async () => null)
    await request(app).get('/api/me').expect(401)
    await request(app).get('/api/me').set(signedIn).expect(401)
  })
})
