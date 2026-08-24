// Steering the API's outside world from a web test.
//
// The server suite starts its own fixture server per file and configures it in
// process (`server/testing/external-web.ts`). The web suite cannot: the API it
// talks to runs in the globalSetup process, so the outside world it fetches
// from lives there too. This posts to that server's control endpoint instead —
// still one real HTTP server, answering the API over a real socket; only the
// instruction about what to answer travels between processes.
import { afterEach, inject } from 'vitest'
import { CONTROL, type FixtureReply } from '../../server/testing/fixture-server'

const base = inject('outsideWorldUrl')

let steered = false

async function control(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) throw new Error(`steering the outside world failed: HTTP ${res.status}`)
}

async function serve(path: string, reply: FixtureReply): Promise<string> {
  steered = true
  await control(CONTROL.routes, { path, reply })
  return `${base}${path}`
}

/** Nothing found — the shape both photo sources return for a miss. */
const NOTHING_FOUND = { query: { pages: {} } }

export const outside = {
  /** Serve a shop's product page, and return the URL to paste at the app. */
  page: (path: string, html: string) => serve(path, { html }),
  /**
   * A link that cannot be read: the connection dies mid-request.
   *
   * A hostname that does not resolve would do the same job, and used to — but
   * it leaves the machine to ask a DNS server, which makes the test slower
   * offline and dependent on the resolver. A dropped socket here is the same
   * failure, produced locally.
   */
  deadPage: (path: string) => serve(path, { hangUp: true }),
  /** Answer Wikipedia's image search. */
  wikipedia: (payload: unknown) => serve('/wikipedia', { json: payload }),
  /** Answer Wikimedia Commons' image search. */
  commons: (payload: unknown) => serve('/commons', { json: payload }),
  /** Neither photo source finds anything. */
  async noPhotos() {
    await serve('/wikipedia', { json: NOTHING_FOUND })
    await serve('/commons', { json: NOTHING_FOUND })
  },
  /** Answer the translator with this English text. */
  translation: (text: string) =>
    serve('/translate', { json: { responseStatus: 200, responseData: { translatedText: text } } }),
  /** An absolute URL on the outside world for a path nothing has registered. */
  urlFor: (path: string) => `${base}${path}`,
}

// Only when a case actually steered it: the reset is a round trip, and most
// files never touch the outside world at all.
afterEach(async () => {
  if (!steered) return
  steered = false
  await control(CONTROL.reset)
})
