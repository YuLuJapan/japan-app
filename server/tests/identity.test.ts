// lib/identity.ts — who the caller is, said without reference to what they may
// do. The split matters: an account can verify perfectly and still be granted
// nothing, and these cases pin that apart from the authorization in lib/auth.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { getDataStore, setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { clearTokenCache, resolvePrincipal, syncProfile } from '../src/lib/identity.js'
import { TEST_CODE, fixture } from './fixture.js'

const mocks = vi.hoisted(() => ({ resolveAuthUser: vi.fn() }))
vi.mock('../src/lib/supabaseAuth.js', () => ({ resolveAuthUser: mocks.resolveAuthUser }))

// Matches OWNER_USER in the fixture, which holds the membership on trip-1 —
// /api/trip is scoped to the caller's trips now, so an account with none
// would 404 here for reasons that have nothing to do with identity.
const GOOGLE_USER = {
  id: 'user-yuval',
  email: 'yuval@example.com',
  display_name: 'Yuval',
  avatar_url: 'https://example.com/y.png',
}

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  mocks.resolveAuthUser.mockReset()
  clearTokenCache()
})

afterEach(() => {
  delete process.env.TRIP_GUEST_CODE
})

describe('resolvePrincipal', () => {
  it('resolves the static codes without touching the verifier', async () => {
    process.env.TRIP_GUEST_CODE = 'guest-code'
    const verify = vi.fn()

    expect(await resolvePrincipal(TEST_CODE, verify)).toEqual({ kind: 'legacy', code: 'owner' })
    expect(await resolvePrincipal('guest-code', verify)).toEqual({ kind: 'legacy', code: 'guest' })
    expect(verify).not.toHaveBeenCalled()
  })

  it('prefers owner when both codes are set to the same value', async () => {
    process.env.TRIP_GUEST_CODE = TEST_CODE
    expect(await resolvePrincipal(TEST_CODE, vi.fn())).toEqual({ kind: 'legacy', code: 'owner' })
  })

  it('resolves a verified JWT to a user principal', async () => {
    const verify = vi.fn().mockResolvedValue(GOOGLE_USER)
    expect(await resolvePrincipal('a.jwt', verify)).toEqual({ kind: 'user', user: GOOGLE_USER })
  })

  it('returns null for an empty or unverifiable token', async () => {
    const verify = vi.fn().mockResolvedValue(null)
    expect(await resolvePrincipal('', verify)).toBeNull()
    expect(await resolvePrincipal('garbage', verify)).toBeNull()
    // The empty token short-circuits before the verifier is ever reached.
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('resolves any account — reaching a trip is a separate question', async () => {
    // Identity says nothing about authorization: a stranger resolves to a
    // perfectly valid principal and then reaches no trip at all
    // (see membership.test.ts).
    const stranger = { ...GOOGLE_USER, id: 'user-stranger', email: 'stranger@example.com' }
    const verify = vi.fn().mockResolvedValue(stranger)
    expect(await resolvePrincipal('a.jwt', verify)).toEqual({ kind: 'user', user: stranger })
  })
})

describe('token cache', () => {
  it('verifies a token once and serves repeats from cache', async () => {
    const verify = vi.fn().mockResolvedValue(GOOGLE_USER)
    await resolvePrincipal('a.jwt', verify)
    await resolvePrincipal('a.jwt', verify)
    await resolvePrincipal('a.jwt', verify)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('caches rejections too, so a dead token cannot hammer Supabase', async () => {
    const verify = vi.fn().mockResolvedValue(null)
    await resolvePrincipal('dead.jwt', verify)
    await resolvePrincipal('dead.jwt', verify)
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('keeps distinct tokens apart', async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce(GOOGLE_USER)
      .mockResolvedValueOnce({ ...GOOGLE_USER, id: 'user-luciana' })
    const first = await resolvePrincipal('one.jwt', verify)
    const second = await resolvePrincipal('two.jwt', verify)
    expect(first).not.toEqual(second)
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('expires entries so a revoked token stops working', async () => {
    vi.useFakeTimers()
    try {
      const verify = vi.fn().mockResolvedValue(GOOGLE_USER)
      await resolvePrincipal('a.jwt', verify)
      vi.advanceTimersByTime(61_000)
      verify.mockResolvedValue(null)
      expect(await resolvePrincipal('a.jwt', verify)).toBeNull()
      expect(verify).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('profile sync', () => {
  it('records the signed-in account on first authenticated request', async () => {
    mocks.resolveAuthUser.mockResolvedValue(GOOGLE_USER)
    await request(app).get('/api/trip').set('Authorization', 'Bearer a.jwt').expect(200)

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
    mocks.resolveAuthUser.mockResolvedValue(GOOGLE_USER)

    for (let i = 0; i < 3; i++) {
      await request(app).get('/api/trip').set('Authorization', 'Bearer a.jwt').expect(200)
    }
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('never fails the request when the profiles table is unavailable', async () => {
    const store = createMemoryStore(fixture())
    store.upsertProfile = () => Promise.reject(new Error('relation "profiles" does not exist'))
    setDataStore(store)
    mocks.resolveAuthUser.mockResolvedValue(GOOGLE_USER)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The whole point: an unmigrated database degrades to "no profile row",
    // not to a 500 on every authenticated call.
    await request(app).get('/api/trip').set('Authorization', 'Bearer a.jwt').expect(200)
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
    mocks.resolveAuthUser.mockResolvedValue(GOOGLE_USER)
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer a.jwt')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      user: {
        id: 'user-yuval',
        email: 'yuval@example.com',
        display_name: 'Yuval',
        avatar_url: 'https://example.com/y.png',
      },
      role: 'owner',
    })
  })

  it('returns a null user for a static access code — a right, not an identity', async () => {
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${TEST_CODE}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user: null, role: 'owner' })
  })

  it('requires authentication like every other route', async () => {
    await request(app).get('/api/me').expect(401)
  })
})
