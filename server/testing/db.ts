// Direct SQL against the test stack's Postgres, for the things the app's own
// API cannot express: resetting between tests, and staging failures that are
// real rather than injected.
import { Pool } from 'pg'
import { inject } from 'vitest'
import { DB, SERVICE_KEY } from './stack-config.js'

// Read once, at import: `inject` is only meaningful in a worker, and reaching
// for it deep inside a helper makes a failure there look like a fixture bug.
const restUrl = inject('supabaseUrl')

let pool: Pool | null = null

/** One pool per worker, opened on first use and closed by the setup file. */
export function testDb(): Pool {
  pool ??= new Pool({
    host: inject('dbHost'),
    port: inject('dbPort'),
    user: DB.user,
    password: DB.password,
    database: DB.database,
    // A handful of statements per test, run one file at a time — a large pool
    // would only hold connections open against a server that has a hundred.
    max: 4,
  })
  return pool
}

export async function closeTestDb(): Promise<void> {
  await pool?.end().catch(() => {})
  pool = null
}

/**
 * Runs `fn` with a table genuinely absent, then puts it back.
 *
 * The app promises to degrade rather than 500 when a table it expects has not
 * been migrated yet. Replacing a store method with one that throws would test
 * the `catch`; renaming the table tests the promise — PostgREST returns the
 * same error a real unmigrated project would.
 */
export async function withTableMissing<T>(table: string, fn: () => Promise<T>): Promise<T> {
  const db = testDb()
  const hidden = `${table}__hidden_for_test`
  await db.query(`alter table public."${table}" rename to "${hidden}"`)
  // Everything from here on is inside the try: a table left renamed would
  // break every later test in the file with an error about the fixture rather
  // than about this one, which is a miserable trail to follow back.
  try {
    await settleSchemaCache(`${table}?select=*&limit=1`, false, table)
    return await fn()
  } finally {
    await db.query(`alter table public."${hidden}" rename to "${table}"`)
    // Waiting for the reload matters more on the way back: PostgREST picks it
    // up asynchronously, and the next test seeds the fixture immediately.
    // Without this the table is there and PostgREST still says it is not.
    await settleSchemaCache(`${table}?select=*&limit=1`, true, table)
  }
}

/**
 * Runs `fn` with columns genuinely absent, then puts them back.
 *
 * The Supabase store tolerates a deploy that reaches production before its
 * migration does: the query comes back 42703 undefined_column and it retries
 * without the new fields. Renaming the columns away produces that error from
 * Postgres itself, so the fallback is driven by the thing it was written for
 * rather than by a hand-built query builder agreeing to say 42703.
 */
export async function withColumnsMissing<T>(
  table: string,
  columns: string[],
  fn: () => Promise<T>
): Promise<T> {
  const db = testDb()
  const hidden = (column: string) => `${column}__hidden_for_test`
  for (const column of columns) {
    await db.query(`alter table public."${table}" rename column "${column}" to "${hidden(column)}"`)
  }
  const probe = `${table}?select=${columns.join(',')}&limit=1`
  try {
    await settleSchemaCache(probe, false, `${table}.${columns.join('/')}`)
    return await fn()
  } finally {
    for (const column of columns) {
      await db.query(
        `alter table public."${table}" rename column "${hidden(column)}" to "${column}"`
      )
    }
    await settleSchemaCache(probe, true, `${table}.${columns.join('/')}`)
  }
}

/**
 * Asks PostgREST to re-read the schema, and waits until it has *settled*.
 *
 * The settling is the point. A rename produces two reloads in quick
 * succession, and PostgREST handles them asynchronously — so a single probe
 * taken right after the second NOTIFY can be answered by a cache the first
 * NOTIFY is still about to replace. Reading the state we want once therefore
 * proves nothing; reading it several times in a row does, because a reload
 * still in flight would land in the middle.
 */
async function settleSchemaCache(
  probe: string,
  shouldExist: boolean,
  label: string
): Promise<void> {
  await testDb().query(`notify pgrst, 'reload schema'`)
  const url = `${restUrl}/rest/v1/${probe}`
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  const deadline = Date.now() + 15_000
  // supabase/postgres also has a DDL event trigger that reloads the cache, so
  // a rename queues a reload of its own alongside ours. The one from the
  // *previous* rename can still be in flight, which is why the state has to
  // hold for a stretch rather than merely be true once.
  const SETTLED_FOR_MS = 1_000
  let agreeingSince: number | null = null
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers }).catch(() => null)
    if (res && res.ok === shouldExist) {
      agreeingSince ??= Date.now()
      if (Date.now() - agreeingSince >= SETTLED_FOR_MS) return
    } else {
      agreeingSince = null
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`PostgREST never agreed that ${label} ${shouldExist ? 'exists' : 'is missing'}`)
}
