// Local capture rig for the promo video. NOT part of the app, never deployed.
//
// The app has no way in without Supabase Auth (feature 002 phase 6b removed
// the shared codes), which is correct for production and useless for
// screenshotting. This boots the real Express app and the real frontend build
// against the memory datastore, with `setTokenVerifier` — the same seam the
// test suite uses — resolving one fixed demo token to one demo account.
//
// Nothing here is importable by `api/index.ts` or `server/dev.ts`, so it
// cannot reach a deployment: it is a standalone entry point that has to be run
// on purpose, with the data it invents passed in by hand.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createApp } from '../server/src/app.js'
import { setDataStore } from '../server/src/lib/datastore.js'
import { createMemoryStore, type MemoryData } from '../server/src/lib/datastore.memory.js'
import { setTokenVerifier } from '../server/src/lib/identity.js'

const PORT = Number(process.env.DEMO_PORT ?? 4321)
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** The account the capture browser signs in as. */
export const DEMO_TOKEN = 'demo.jwt'
const DEMO_USER = {
  id: 'demo-user',
  email: 'yuval@example.com',
  email_confirmed: true,
  display_name: 'Yuval',
  avatar_url: null,
}
const PARTNER = {
  id: 'demo-partner',
  email: 'luciana@example.com',
  email_confirmed: true,
  display_name: 'Luciana',
  avatar_url: null,
}

/**
 * A booking that does not exist.
 *
 * `placeholder-data.json` carries the travellers' real Ethiopian Airlines
 * reference and ticket numbers, because it mirrors what is in the live
 * database. That is right for the seed and wrong for a video going on
 * LinkedIn, so the capture rig swaps it for a fictional one. The seed itself
 * is left alone.
 */
const DEMO_FLIGHT = {
  airline: 'Pacific Air',
  booking_ref: 'DEMO42',
  outbound: {
    depart_at: '2026-09-18T15:35:00+03:00',
    depart_tz: 'Asia/Jerusalem',
    arrive_at: '2026-09-19T19:40:00+09:00',
    arrive_tz: 'Asia/Tokyo',
    legs: [
      { flight_no: 'PA 101', from: 'Tel Aviv (TLV)', to: 'Singapore (SIN)' },
      { flight_no: 'PA 220', from: 'Singapore (SIN)', to: 'Narita (NRT)' },
    ],
  },
  return_flight: {
    depart_at: '2026-10-16T20:40:00+09:00',
    depart_tz: 'Asia/Tokyo',
    arrive_at: '2026-10-17T14:35:00+03:00',
    arrive_tz: 'Asia/Jerusalem',
    legs: [
      { flight_no: 'PA 221', from: 'Narita (NRT)', to: 'Singapore (SIN)' },
      { flight_no: 'PA 102', from: 'Singapore (SIN)', to: 'Tel Aviv (TLV)' },
    ],
  },
}

/**
 * The shipped placeholder trip, plus the two accounts it belongs to. The
 * content is the real thing — that JSON is the seed the live database was
 * built from — so the footage shows the actual app, not a mock of it. Only
 * the flight is substituted, for the reason above.
 */
function demoData(): MemoryData {
  const file = path.join(ROOT, 'server/src/data/placeholder-data.json')
  const data = JSON.parse(readFileSync(file, 'utf-8')) as MemoryData
  const full = { can_see_stays: true, can_see_flight: true, can_see_documents: true }
  return {
    ...data,
    trips: data.trips.map((t) => ({ ...t, flight: DEMO_FLIGHT })),
    profiles: [DEMO_USER, PARTNER].map(({ email_confirmed: _c, ...p }) => p),
    members: [
      { trip_id: 'trip-japan', user_id: DEMO_USER.id, role: 'owner', ...full },
      { trip_id: 'trip-japan', user_id: PARTNER.id, role: 'partner', ...full },
    ],
  }
}

setDataStore(createMemoryStore(demoData()))
setTokenVerifier(async (token) => (token === DEMO_TOKEN ? DEMO_USER : null))

const api = createApp()
const app = express()
// Only /api goes to the API. `createApp` applies authMiddleware to everything
// it is given, which in production is fine — vercel.json routes only /api/* to
// the function — but here it would 401 the static files too.
app.use((req, res, next) => (req.path.startsWith('/api') ? api(req, res, next) : next()))
// The production build, so the capture shows exactly what ships.
app.use(express.static(path.join(ROOT, 'dist')))
app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'dist/index.html')))

app.listen(PORT, () => console.log(`demo app on http://localhost:${PORT}`))
