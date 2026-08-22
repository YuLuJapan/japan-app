// Account sign-in: a bearer token that isn't either static code is verified as
// a Supabase Auth JWT, and the resulting email is checked against
// TRIP_OWNER_EMAILS. resolveAuthUser is mocked here so the test needs neither a
// real Supabase project nor network access.
//
// The allow-list is a placeholder for per-trip membership (phase 2). What this
// file pins down is the split underneath it: verifying a token and granting a
// role are two separate steps, so an account can authenticate successfully and
// still be refused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { clearTokenCache } from '../src/lib/identity.js'
import { TEST_CODE, fixture } from './fixture.js'

const mocks = vi.hoisted(() => ({ resolveAuthUser: vi.fn() }))

vi.mock('../src/lib/supabaseAuth.js', () => ({
  resolveAuthUser: mocks.resolveAuthUser,
}))

const user = (email: string, extra: Record<string, unknown> = {}) => ({
  id: 'user-yuval',
  email,
  display_name: null,
  avatar_url: null,
  ...extra,
})

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  mocks.resolveAuthUser.mockReset()
  // The token cache is process-wide, so cases reusing a token string would
  // otherwise see the previous case's verdict.
  clearTokenCache()
  process.env.TRIP_OWNER_EMAILS = 'yuval@example.com, Luciana@Example.com'
})

afterEach(() => {
  delete process.env.TRIP_OWNER_EMAILS
})

describe('account sign-in via Supabase Auth', () => {
  it('grants owner for a token that verifies to an allow-listed email', async () => {
    mocks.resolveAuthUser.mockResolvedValue(user('yuval@example.com'))
    const res = await request(app).get('/api/trip').set('Authorization', 'Bearer some.jwt.token')
    expect(res.status).toBe(200)
  })

  it('matches case-insensitively and trims the allow-list', async () => {
    mocks.resolveAuthUser.mockResolvedValue(user('  LUCIANA@example.com  '.trim()))
    const res = await request(app).get('/api/trip').set('Authorization', 'Bearer some.jwt.token')
    expect(res.status).toBe(200)
  })

  it('rejects a token that verifies but whose email is not allow-listed', async () => {
    mocks.resolveAuthUser.mockResolvedValue(user('friend@example.com'))
    const res = await request(app).get('/api/trip').set('Authorization', 'Bearer some.jwt.token')
    expect(res.status).toBe(401)
  })

  it('rejects a token that does not verify at all', async () => {
    mocks.resolveAuthUser.mockResolvedValue(null)
    const res = await request(app).get('/api/trip').set('Authorization', 'Bearer garbage')
    expect(res.status).toBe(401)
  })

  it('never calls Supabase for the static access code (fast path)', async () => {
    const res = await request(app).get('/api/trip').set('Authorization', `Bearer ${TEST_CODE}`)
    expect(res.status).toBe(200)
    expect(mocks.resolveAuthUser).not.toHaveBeenCalled()
  })

  it('POST /api/auth/verify also grants owner via a verified email', async () => {
    mocks.resolveAuthUser.mockResolvedValue(user('yuval@example.com'))
    const res = await request(app).post('/api/auth/verify').send({ code: 'some.jwt.token' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, role: 'owner' })
  })
})
