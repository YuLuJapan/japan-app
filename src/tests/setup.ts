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
import { closeTestDb, testDb } from '../../server/testing/db'
import { OWNER_USER, seedFixture } from '../../server/testing/fixture'
import {
  assertNoOutboundAttempts,
  blockOutboundFetch,
  blockOutboundNodeHttp,
  blockOutboundXhr,
  OUTBOUND_REPORT,
} from '../../server/testing/no-outbound'
import { resetData } from '../../server/testing/schema'
import { assertLocalTarget } from '../../server/testing/stack-config'
import { db, signInAs } from './data'

// jsdom has no layout engine and leaves Element.scrollTo undefined; the day strip
// calls it on mount to keep the selected chip in view.
Element.prototype.scrollTo ??= () => {}

// jsdom implements no media queries either. Answering "no" to all of them is
// what a browser tab reports — `(display-mode: standalone)` is false unless
// the app was launched from the Home Screen, which is the case push.ts reads.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList

const apiUrl = inject('apiUrl')
const outsideWorldUrl = inject('outsideWorldUrl')

// Nothing in a web test leaves the machine either: the API is local, the
// database is a container, and the one third party the browser half talks to
// (PostHog) is pointed at the fixture server.
blockOutboundFetch('web test')
blockOutboundNodeHttp('web test')
blockOutboundXhr('web test')

// Vite loads `.env` / `.env.local` into `import.meta.env` in test mode too, so
// a developer with the real project's keys in one would have these tests
// signing in to it. Cleared here; the two files that need a browser-side
// client (the gate, sign-out) stub them at the stack's Auth service instead.
import.meta.env.VITE_SUPABASE_URL = ''
import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY = ''

// The client builds `${VITE_API_BASE}/api/...`. Empty in a browser, where the
// app is served from the same origin; here it has to name the API's port,
// because a relative URL outside a browser is relative to nothing.
import.meta.env.VITE_API_BASE = apiUrl
assertLocalTarget(apiUrl, 'the test API URL')
assertLocalTarget(inject('supabaseUrl'), 'the test stack URL')

beforeEach(async () => {
  localStorage.clear()
  await resetData(testDb())
  await seedFixture(db)
  signInAs(OWNER_USER)
})

afterEach(async () => {
  localStorage.clear()
  assertNoOutboundAttempts()
  // The API runs in the globalSetup process, so its own attempts are reported
  // over a socket rather than shared in memory.
  const res = await fetch(`${outsideWorldUrl}${OUTBOUND_REPORT}`)
  assertNoOutboundAttempts((await res.json()) as string[])
})

afterAll(async () => {
  await closeTestDb()
})
