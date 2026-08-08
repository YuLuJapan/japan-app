// Owner sign-in via Supabase magic-link: a bearer token that isn't either
// static code is verified as a Supabase Auth JWT, and the resulting email is
// checked against TRIP_OWNER_EMAILS. resolveOwnerEmail is mocked here so the
// test doesn't need a real Supabase project or network access.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { TEST_CODE, fixture } from './fixture.js'

const mocks = vi.hoisted(() => ({ resolveOwnerEmail: vi.fn() }))

vi.mock('../src/lib/supabaseAuth.js', () => ({
  resolveOwnerEmail: mocks.resolveOwnerEmail,
}))

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  mocks.resolveOwnerEmail.mockReset()
  process.env.TRIP_OWNER_EMAILS = 'yuval@example.com, Luciana@Example.com'
})

afterEach(() => {
  delete process.env.TRIP_OWNER_EMAILS
})

describe('owner sign-in via Supabase magic-link', () => {
  it('grants owner for a token that verifies to an allow-listed email', async () => {
    mocks.resolveOwnerEmail.mockResolvedValue('yuval@example.com')
    const res = await request(app).get('/api/trip').set('Authorization', 'Bearer some.jwt.token')
    expect(res.status).toBe(200)
  })

  it('matches case-insensitively and trims the allow-list', async () => {
    mocks.resolveOwnerEmail.mockResolvedValue('  LUCIANA@example.com  '.trim())
    const res = await request(app).get('/api/trip').set('Authorization', 'Bearer some.jwt.token')
    expect(res.status).toBe(200)
  })

  it('rejects a token that verifies but whose email is not allow-listed', async () => {
    mocks.resolveOwnerEmail.mockResolvedValue('friend@example.com')
    const res = await request(app).get('/api/trip').set('Authorization', 'Bearer some.jwt.token')
    expect(res.status).toBe(401)
  })

  it('rejects a token that does not verify at all', async () => {
    mocks.resolveOwnerEmail.mockResolvedValue(null)
    const res = await request(app).get('/api/trip').set('Authorization', 'Bearer garbage')
    expect(res.status).toBe(401)
  })

  it('never calls Supabase for the static access code (fast path)', async () => {
    const res = await request(app).get('/api/trip').set('Authorization', `Bearer ${TEST_CODE}`)
    expect(res.status).toBe(200)
    expect(mocks.resolveOwnerEmail).not.toHaveBeenCalled()
  })

  it('POST /api/auth/verify also grants owner via a verified email', async () => {
    mocks.resolveOwnerEmail.mockResolvedValue('yuval@example.com')
    const res = await request(app).post('/api/auth/verify').send({ code: 'some.jwt.token' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, role: 'owner' })
  })
})
