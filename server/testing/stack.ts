// A real Supabase stack, in containers, for the duration of a test run.
//
// The same five services as `local/docker-compose.yml` and the same two config
// files — this is the compose stack with ports allocated dynamically and a
// lifetime tied to the process, not a second definition of it.
//
// Why a whole stack rather than a bare Postgres: production runs
// DATA_BACKEND=supabase, and that store talks PostgREST and the Storage API
// over HTTP, not SQL. A test against plain Postgres would exercise a code path
// the deployed app never takes, which is the kind of gap that ships green and
// 500s on first contact.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { GenericContainer, Network, Wait, type StartedTestContainer } from 'testcontainers'
import { applyMigrations } from './schema.js'
import {
  ANON_KEY,
  DB,
  FILES_BUCKET,
  GATEWAY_PORT,
  IMAGES,
  JWT_SECRET,
  SERVICE_KEY,
} from './stack-config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
/** The compose stack's config files, reused verbatim so the two cannot diverge. */
const INIT_DIR = path.join(here, '../../local/init')

export interface SupabaseStack {
  /** What to set SUPABASE_URL to. */
  url: string
  /** Direct SQL, for the things HTTP cannot do: migrations, truncation. */
  pool: Pool
  stop(): Promise<void>
}

/** Polls until `check` passes, so a slow container is a wait rather than a flake. */
async function waitForHttp(
  label: string,
  url: string,
  check: (res: Response) => boolean,
  { timeoutMs = 60_000, headers = {} as Record<string, string> } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no attempt made'
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers })
      if (check(res)) return
      lastError = `HTTP ${res.status}`
    } catch (err) {
      lastError = (err as Error).message
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`${label} never became ready at ${url} (last: ${lastError})`)
}

/** Retries the first query: Postgres accepts connections slightly before it accepts work. */
async function waitForPostgres(pool: Pool, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no attempt made'
  while (Date.now() < deadline) {
    try {
      await pool.query('select 1')
      return
    } catch (err) {
      lastError = (err as Error).message
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`postgres never became ready (last: ${lastError})`)
}

/**
 * Boots the stack and returns once it can actually serve the app.
 *
 * Set `TEST_SUPABASE_URL` to point at an already-running stack instead (the
 * compose one, say) — the boot is most of a test run's wall clock, and paying
 * it once while iterating is worth the option.
 */
export async function startSupabaseStack(): Promise<SupabaseStack> {
  const existing = process.env.TEST_SUPABASE_URL
  if (existing) return attachToStack(existing)

  const network = await new Network().start()
  const started: StartedTestContainer[] = []
  const track = (c: StartedTestContainer) => (started.push(c), c)

  const stopAll = async () => {
    // Reverse order, so nothing is left talking to a container that has gone.
    for (const container of started.reverse()) await container.stop().catch(() => {})
    await network.stop().catch(() => {})
  }

  try {
    const db = track(
      await new GenericContainer(IMAGES.db)
        .withNetwork(network)
        .withNetworkAliases('db')
        .withEnvironment({ POSTGRES_PASSWORD: DB.password })
        .withCopyFilesToContainer([
          {
            source: path.join(INIT_DIR, 'zz-roles.sql'),
            target: '/docker-entrypoint-initdb.d/zz-roles.sql',
          },
        ])
        .withExposedPorts(DB.port)
        // During initdb the server listens on the unix socket only, so a TCP
        // pg_isready is what distinguishes "still setting up" from "open".
        .withWaitStrategy(Wait.forSuccessfulCommand(`pg_isready -h 127.0.0.1 -U ${DB.user}`))
        .withStartupTimeout(180_000)
        .start()
    )

    const internalDbUri = (role: string) =>
      `postgres://${role}:${DB.password}@db:${DB.port}/${DB.database}`

    // REST, Auth and Storage only depend on the database, so they come up together.
    const [, ,] = await Promise.all([
      new GenericContainer(IMAGES.rest)
        .withNetwork(network)
        .withNetworkAliases('rest')
        .withEnvironment({
          PGRST_DB_URI: internalDbUri('authenticator'),
          PGRST_DB_SCHEMAS: 'public,storage',
          PGRST_DB_ANON_ROLE: 'anon',
          PGRST_JWT_SECRET: JWT_SECRET,
          PGRST_DB_USE_LEGACY_GUCS: 'false',
        })
        .start()
        .then(track),
      new GenericContainer(IMAGES.auth)
        .withNetwork(network)
        .withNetworkAliases('auth')
        .withEnvironment({
          GOTRUE_API_HOST: '0.0.0.0',
          PORT: '9999',
          API_EXTERNAL_URL: 'http://auth:9999',
          GOTRUE_DB_DRIVER: 'postgres',
          GOTRUE_DB_DATABASE_URL: internalDbUri('supabase_auth_admin'),
          GOTRUE_SITE_URL: 'http://localhost:3000',
          GOTRUE_URI_ALLOW_LIST: '*',
          GOTRUE_JWT_SECRET: JWT_SECRET,
          GOTRUE_JWT_AUD: 'authenticated',
          GOTRUE_JWT_EXP: '3600',
          GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
          GOTRUE_JWT_ADMIN_ROLES: 'service_role',
          GOTRUE_DISABLE_SIGNUP: 'false',
          GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
          // No SMTP here. Accounts that need to look unconfirmed are made so
          // afterwards (see `unconfirmEmail`), which is also the only order
          // GoTrue will hand out a token in.
          GOTRUE_MAILER_AUTOCONFIRM: 'true',
        })
        .start()
        .then(track),
      new GenericContainer(IMAGES.storage)
        .withNetwork(network)
        .withNetworkAliases('storage')
        .withEnvironment({
          ANON_KEY,
          SERVICE_KEY,
          PGRST_JWT_SECRET: JWT_SECRET,
          DATABASE_URL: internalDbUri('supabase_storage_admin'),
          POSTGREST_URL: 'http://rest:3000',
          STORAGE_BACKEND: 'file',
          FILE_STORAGE_BACKEND_PATH: '/var/lib/storage',
          FILE_SIZE_LIMIT: '52428800',
          TENANT_ID: 'test',
          REGION: 'test',
          GLOBAL_S3_BUCKET: 'test',
        })
        .start()
        .then(track),
    ])

    track(
      await new GenericContainer(IMAGES.gateway)
        .withNetwork(network)
        .withNetworkAliases('gateway')
        .withCopyFilesToContainer([
          {
            source: path.join(INIT_DIR, 'gateway.conf'),
            target: '/etc/nginx/conf.d/default.conf',
          },
        ])
        .withExposedPorts(GATEWAY_PORT)
        .start()
    )

    const gateway = started[started.length - 1]
    const url = `http://${gateway.getHost()}:${gateway.getMappedPort(GATEWAY_PORT)}`

    const pool = new Pool({
      host: db.getHost(),
      port: db.getMappedPort(DB.port),
      user: DB.user,
      password: DB.password,
      database: DB.database,
    })

    await waitForPostgres(pool)
    await applyMigrations(pool)
    await ensureFilesBucket(pool)
    await waitForStackReady(url)

    return {
      url,
      pool,
      stop: async () => {
        await pool.end().catch(() => {})
        await stopAll()
      },
    }
  } catch (err) {
    await stopAll()
    throw err
  }
}

/** Reuses a stack somebody else started (`TEST_SUPABASE_URL`), migrations included. */
async function attachToStack(url: string): Promise<SupabaseStack> {
  const pool = new Pool({
    host: process.env.TEST_SUPABASE_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_SUPABASE_DB_PORT ?? 54322),
    user: DB.user,
    password: DB.password,
    database: DB.database,
  })
  await waitForPostgres(pool, 10_000)
  await applyMigrations(pool)
  await ensureFilesBucket(pool)
  await waitForStackReady(url)
  return { url, pool, stop: async () => void (await pool.end().catch(() => {})) }
}

/** Every service answering through the gateway — the state the app assumes. */
async function waitForStackReady(url: string): Promise<void> {
  await waitForHttp('gateway', `${url}/gateway-health`, (r) => r.ok)
  await waitForHttp('auth', `${url}/auth/v1/health`, (r) => r.ok)
  await waitForHttp('rest', `${url}/rest/v1/trips?select=id&limit=1`, (r) => r.ok, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  await waitForHttp('storage', `${url}/storage/v1/bucket`, (r) => r.ok, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
}

/**
 * The bucket the app uploads into. Created in SQL rather than through the
 * Storage API because it has to exist before the first request, and it is not
 * something the app itself ever creates — on a real project a human made it once.
 */
async function ensureFilesBucket(pool: Pool): Promise<void> {
  await pool.query(
    `insert into storage.buckets (id, name) values ($1, $1) on conflict (id) do nothing`,
    [FILES_BUCKET]
  )
}
