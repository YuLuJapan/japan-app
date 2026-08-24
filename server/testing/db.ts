// Direct SQL against the test stack's Postgres, for the things the app's own
// API cannot express: resetting between tests, and staging failures that are
// real rather than injected.
import { Pool } from 'pg'
import { inject } from 'vitest'
import { settleSchemaCache } from './schema.js'
import { DB } from './stack-config.js'

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
    await settle(`${table}?select=*&limit=1`, false, table)
    return await fn()
  } finally {
    await db.query(`alter table public."${hidden}" rename to "${table}"`)
    // Waiting for the reload matters more on the way back: PostgREST picks it
    // up asynchronously, and the next test seeds the fixture immediately.
    // Without this the table is there and PostgREST still says it is not.
    await settle(`${table}?select=*&limit=1`, true, table)
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
    await settle(probe, false, `${table}.${columns.join('/')}`)
    return await fn()
  } finally {
    for (const column of columns) {
      await db.query(
        `alter table public."${table}" rename column "${hidden(column)}" to "${column}"`
      )
    }
    await settle(probe, true, `${table}.${columns.join('/')}`)
  }
}

/** The shared settle, with this worker's runner and REST origin filled in. */
const settle = (probe: string, shouldExist: boolean, label: string) =>
  settleSchemaCache({ runner: testDb(), restUrl, probe, shouldExist, label, timeoutMs: 15_000 })
