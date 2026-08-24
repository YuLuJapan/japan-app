// Runs before every web test file.
//
// The components under test now talk to the real API over HTTP — the one
// global-setup started against the container stack — instead of to a stubbed
// `api/client`. A stub could only ever return what the test author believed
// the server sends; this way the shapes are the server's own, so a client
// reading a field the API stopped returning fails here rather than in a
// browser.
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeEach, inject } from 'vitest'
import { ACCESS_CODE_KEY } from '../api/client'
import { closeTestDb, testDb } from '../../server/testing/db'
import { type TestAccount } from '../../server/testing/accounts'
import { OWNER_USER, seedFixture } from '../../server/testing/fixture'
import { resetData } from '../../server/testing/schema'
import { db } from './data'

// jsdom has no layout engine and leaves Element.scrollTo undefined; the day strip
// calls it on mount to keep the selected chip in view.
Element.prototype.scrollTo ??= () => {}

const apiUrl = inject('apiUrl')
const tokens = inject('authTokens')

// The client builds `${VITE_API_BASE}/api/...`. Empty in a browser, where the
// app is served from the same origin; here it has to name the API's port,
// because a relative URL outside a browser is relative to nothing.
import.meta.env.VITE_API_BASE = apiUrl

/**
 * Puts a real, signed-in token where the client looks for one.
 *
 * The default is the owner of trip-1, which is who almost every screen is
 * rendered as; a test that cares calls this again with somebody else.
 */
export function signInAs(user: TestAccount): void {
  const token = tokens[user.email]
  if (!token) throw new Error(`no token was provisioned for ${user.email}`)
  localStorage.setItem(ACCESS_CODE_KEY, token)
}

beforeEach(async () => {
  localStorage.clear()
  await resetData(testDb())
  await seedFixture(db)
  signInAs(OWNER_USER)
})

afterEach(() => {
  localStorage.clear()
})

afterAll(async () => {
  await closeTestDb()
})
