// Recording that someone accepted the terms.
//
// The gate promised "By continuing you agree to the terms and privacy policy"
// long before either document existed and while nothing recorded the
// agreement. These cases cover the half that lives in the database.
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore, type DataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { CURRENT_TERMS_VERSION } from '../src/lib/terms.js'
import { fixture } from './fixture.js'
import { OWNER_BEARER, useTestTokens } from './auth.js'

const app = createApp()
let store: DataStore

beforeEach(() => {
  store = createMemoryStore(fixture())
  setDataStore(store)
  useTestTokens()
})

const me = () => request(app).get('/api/me').set(OWNER_BEARER)
const accept = () => request(app).post('/api/me/terms').set(OWNER_BEARER).send({})

describe('accepting the terms', () => {
  it('starts un-accepted, so an existing account is asked', async () => {
    // Nothing is backfilled: recording a consent nobody gave would be worse
    // than asking again.
    expect((await me()).body.terms).toEqual({ accepted: false, version: CURRENT_TERMS_VERSION })
  })

  it('records the acceptance and stops asking', async () => {
    expect((await accept()).status).toBe(200)
    expect((await me()).body.terms.accepted).toBe(true)
  })

  it('stores when, and which version', async () => {
    await accept()
    const profile = await store.getProfile('user-yuval')
    expect(profile?.accepted_terms_version).toBe(CURRENT_TERMS_VERSION)
    expect(Date.parse(profile?.accepted_terms_at ?? '')).not.toBeNaN()
  })

  it('asks again once the terms change', async () => {
    // The whole reason the version is stored beside the timestamp.
    await accept()
    await store.acceptTerms('user-yuval', '2020-01-01', new Date().toISOString())
    expect((await me()).body.terms.accepted).toBe(false)
  })

  it('ignores a version sent by the client', async () => {
    // Otherwise an account could "accept" text it was never shown.
    await request(app).post('/api/me/terms').set(OWNER_BEARER).send({ version: 'whatever-i-like' })
    expect((await store.getProfile('user-yuval'))?.accepted_terms_version).toBe(
      CURRENT_TERMS_VERSION
    )
  })

  it('is idempotent', async () => {
    await accept()
    expect((await accept()).status).toBe(200)
    expect((await me()).body.terms.accepted).toBe(true)
  })

  it('signing in again is not agreeing again', async () => {
    // syncProfile runs on every authenticated request; it must never touch the
    // acceptance columns, or a version bump would silently re-accept itself.
    await accept()
    await store.upsertProfile({ id: 'user-yuval', email: 'yuval@example.com' })
    expect((await store.getProfile('user-yuval'))?.accepted_terms_version).toBe(
      CURRENT_TERMS_VERSION
    )
  })

  it('needs an account, like every other route', async () => {
    await request(app).post('/api/me/terms').send({}).expect(401)
  })
})
