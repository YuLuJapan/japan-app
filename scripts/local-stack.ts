// The local Supabase stack: bring it up, migrate it, fill it with the real
// placeholder content, and give yourself an account that can sign in.
//
// `npm run dev` on its own still runs the in-memory backend, which is fine for
// most work and needs no Docker. This is for the rest of it — anything where
// the answer depends on Postgres, PostgREST, Storage or Auth actually being
// there, which is everything the deployed app does.
//
//   npm run local:up      start it, migrate, seed
//   npm run dev:local     the above, then the API and the client against it
//   npm run local:down    stop it (the data survives)
//   npm run local:reset   throw the data away and start again
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import { applyMigrations, settleSchemaCache } from '../server/testing/schema.js'
import {
  ANON_KEY,
  COMPOSE_PORTS,
  DB,
  FILES_BUCKET,
  SERVICE_KEY,
  stackEnv,
} from '../server/testing/stack-config.js'
import { seedBlobs, seedRows } from './seed-lib'

const COMPOSE_FILE = path.join(process.cwd(), 'local/docker-compose.yml')
const SUPABASE_URL = `http://localhost:${COMPOSE_PORTS.gateway}`

/** The account you sign in as. Not a secret; it only exists on your machine. */
const DEV_EMAIL = process.env.LOCAL_DEV_EMAIL ?? 'dev@example.com'
const DEV_PASSWORD = process.env.LOCAL_DEV_PASSWORD ?? 'devpassword'

const log = (line = '') => console.log(line)

function compose(...args: string[]): void {
  const res = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], { stdio: 'inherit' })
  if (res.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed — is Docker running?`)
  }
}

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${label} did not come up within ${Math.round(timeoutMs / 1000)}s`)
}

const serviceHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

async function waitForStack(): Promise<void> {
  await waitFor('the gateway', async () => (await fetch(`${SUPABASE_URL}/gateway-health`)).ok)
  await waitFor('Auth', async () => (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok)
  await waitFor(
    'Storage',
    async () => (await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers: serviceHeaders })).ok
  )
}

async function withPostgres<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: 'localhost',
    port: COMPOSE_PORTS.db,
    user: DB.user,
    password: DB.password,
    database: DB.database,
  })
  await waitFor('Postgres', async () => {
    const probe = new Client({
      host: 'localhost',
      port: COMPOSE_PORTS.db,
      user: DB.user,
      password: DB.password,
      database: DB.database,
    })
    try {
      await probe.connect()
      await probe.query('select 1')
      return true
    } finally {
      await probe.end().catch(() => {})
    }
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * Creates (or reuses) the developer account and returns its id.
 *
 * Confirmed on the spot: an unconfirmed address cannot accept an invitation,
 * so leaving it unconfirmed would make the local account a second-class one
 * for no reason.
 */
async function ensureDevAccount(): Promise<string> {
  const headers = { ...serviceHeaders, 'Content-Type': 'application/json' }
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Local Developer' },
    }),
  })
  if (created.ok) return ((await created.json()) as { id: string }).id
  if (created.status !== 422) {
    throw new Error(`creating ${DEV_EMAIL} failed: ${await created.text()}`)
  }
  // Already there from a previous run — find it rather than guessing an id.
  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers })
  const { users = [] } = (await list.json()) as { users?: { id: string; email: string }[] }
  const existing = users.find((u) => u.email?.toLowerCase() === DEV_EMAIL.toLowerCase())
  if (!existing) throw new Error(`${DEV_EMAIL} exists but could not be found in the user list`)
  return existing.id
}

/**
 * Makes the developer the owner of every seeded trip.
 *
 * The placeholder data has no members — it predates accounts — so without this
 * you would sign in successfully and be shown an empty trip list, which looks
 * exactly like the seed having failed.
 */
async function joinEveryTrip(db: SupabaseClient, userId: string): Promise<void> {
  const { error: profileError } = await db
    .from('profiles')
    .upsert({ id: userId, email: DEV_EMAIL, display_name: 'Local Developer' }, { onConflict: 'id' })
  if (profileError) throw new Error(`profiles: ${profileError.message}`)

  const { data: trips, error } = await db.from('trips').select('id')
  if (error) throw new Error(`trips: ${error.message}`)

  const members = ((trips ?? []) as { id: string }[]).map((trip) => ({
    trip_id: trip.id,
    user_id: userId,
    role: 'owner',
    can_see_stays: true,
    can_see_flight: true,
    can_see_documents: true,
    can_see_shopping: true,
  }))
  if (!members.length) return
  const { error: memberError } = await db
    .from('trip_members')
    .upsert(members, { onConflict: 'trip_id,user_id' })
  if (memberError) throw new Error(`trip_members: ${memberError.message}`)
  log(`✓ trip_members: ${DEV_EMAIL} owns ${members.length} trip(s)`)
}

async function up(): Promise<void> {
  log('Starting the local Supabase stack…')
  compose('up', '-d')
  await waitForStack()

  await withPostgres(async (client) => {
    log('Applying supabase/migrations…')
    await applyMigrations(client)
    await client.query(
      `insert into storage.buckets (id, name) values ($1, $1) on conflict (id) do nothing`,
      [FILES_BUCKET]
    )
    // The tables exist in Postgres a moment before PostgREST will admit to
    // them; seeding straight after the migrations 404s on a table plainly there.
    await settleSchemaCache({
      runner: client,
      restUrl: SUPABASE_URL,
      probe: 'trips?select=id&limit=1',
    })
  })

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  log('Seeding placeholder data…')
  await seedRows(db, log)
  await seedBlobs(db, FILES_BUCKET, log)
  await joinEveryTrip(db, await ensureDevAccount())

  log()
  log('Local Supabase stack is up.')
  log(`  SUPABASE_URL   ${SUPABASE_URL}`)
  log(`  Postgres       postgres://postgres:postgres@localhost:${COMPOSE_PORTS.db}/postgres`)
  log(`  Sign in as     ${DEV_EMAIL} / ${DEV_PASSWORD}`)
  log()
  log('  npm run dev:local   run the API and client against it')
  log('  npm run local:down  stop it (data survives)')
  log('  npm run local:reset start over with an empty database')
}

/** The API and the client, pointed at the stack — no .env.local edits needed. */
function dev(): void {
  const child = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...stackEnv(SUPABASE_URL),
      // The browser half signs in against the same Auth service.
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: ANON_KEY,
    },
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}

async function main() {
  const command = process.argv[2] ?? 'up'
  switch (command) {
    case 'up':
      await up()
      return
    case 'dev':
      await up()
      dev()
      return
    case 'down':
      compose('down')
      return
    case 'reset':
      compose('down', '-v')
      await up()
      return
    default:
      throw new Error(`unknown command "${command}" (expected up, dev, down or reset)`)
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
