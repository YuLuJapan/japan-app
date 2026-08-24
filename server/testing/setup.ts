// Runs before every server test file. Points the app at the stack that
// global-setup booted and puts the database back to the fixture before each
// test.
//
// This is what replaced `setDataStore(createMemoryStore(fixture()))`. The app
// now resolves its store the way it does in production — `DATA_BACKEND` and
// the Supabase env vars — so nothing in a test stands between a route and the
// database it is supposed to be talking to.
import { createClient } from '@supabase/supabase-js'
import { afterAll, afterEach, beforeEach, inject } from 'vitest'
import { setDataStore } from '../src/lib/datastore.js'
import { clearTokenCache } from '../src/lib/identity.js'
import { closeTestDb, testDb } from './db.js'
import {
  assertNoOutboundAttempts,
  blockOutboundFetch,
  blockOutboundNodeHttp,
} from './no-outbound.js'
import { seedFixture } from './fixture.js'
import { resetData } from './schema.js'
import { SERVICE_KEY, stackEnv } from './stack-config.js'

const url = inject('supabaseUrl')

// The stack is local and the third parties are answered locally, so nothing
// here has any business leaving the machine. Anything that tries is refused
// and reported rather than silently becoming a real request.
blockOutboundFetch('server test')
blockOutboundNodeHttp('server test')

// Set before anything imports lib/supabase.ts: it caches its client on first
// use, and a client built from a half-set environment stays wrong all run.
Object.assign(process.env, stackEnv(url))

const admin = createClient(url, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

beforeEach(async () => {
  // Whatever a previous file installed, drop it: the store is process-wide and
  // resolving it from env again is what keeps this honest.
  setDataStore(null)
  // Both caches in identity.ts are process-wide and outlive the truncate
  // below. The profile-sync one is the dangerous half: it would decide the
  // signed-in account was already recorded and skip re-inserting a row the
  // reset had just deleted.
  clearTokenCache()
  await resetData(testDb())
  await seedFixture(admin)
})

// Reported per test rather than only at the end: several services treat a
// failed fetch as "nothing found", so the request that leaked and the
// assertion that passed anyway are otherwise never connected.
afterEach(() => {
  assertNoOutboundAttempts()
})

afterAll(async () => {
  await closeTestDb()
})
