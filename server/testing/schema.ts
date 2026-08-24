// Getting a freshly booted Postgres into the shape the app expects, and back
// to a known state between tests.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVICE_KEY } from './stack-config.js'

/**
 * Anything that can run SQL — `pg`'s Pool in tests, its Client in the local
 * stack script. Structural rather than either concrete type, so this module
 * does not force a caller to open a pool it does not otherwise want.
 */
export interface SqlRunner {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

const here = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(here, '../../supabase/migrations')

/**
 * Every migration, in the order the live project had them applied.
 *
 * Sorted by filename, which is the same rule the numbering convention encodes
 * — including the two files that both claim 0019, whose relative order does
 * not matter because they touch different tables.
 */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/**
 * Applies the real `supabase/migrations/*.sql` to a database.
 *
 * Tests running against the same DDL the live project runs is the whole point:
 * a column a migration forgot is a failing test here rather than a 500 in
 * production, which is exactly the gap CLAUDE.md warns about.
 */
export async function applyMigrations(pool: SqlRunner): Promise<void> {
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    try {
      await pool.query(sql)
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`)
    }
  }
  // PostgREST caches the schema and would keep answering 404 for tables it did
  // not know about at boot. Callers wait for that to land with
  // `settleSchemaCache` — the notify alone is not enough, see below.
  await pool.query(`notify pgrst, 'reload schema'`)
}

/**
 * Asks PostgREST to re-read the schema, and waits until the answer has
 * *settled*.
 *
 * The settling is the point. PostgREST handles reloads asynchronously, and
 * supabase/postgres has a DDL event trigger that queues one of its own for
 * every statement — so applying twenty-two migrations leaves a queue of them.
 * A probe taken right after the last NOTIFY can be answered by a cache that
 * one of those queued reloads is still about to replace, which is how seeding
 * fails with a 404 for a table that is plainly there. Seeing the state we want
 * once proves nothing; seeing it hold for a stretch does, because a reload
 * still in flight would land in the middle.
 */
export async function settleSchemaCache(options: {
  runner: SqlRunner
  restUrl: string
  /** A PostgREST query, e.g. `trips?select=id&limit=1`. */
  probe: string
  /** Whether the probe should succeed once the cache is right. */
  shouldExist?: boolean
  /** Named in the timeout message. */
  label?: string
  timeoutMs?: number
}): Promise<void> {
  const { runner, restUrl, probe, shouldExist = true, label = probe, timeoutMs = 30_000 } = options
  await runner.query(`notify pgrst, 'reload schema'`)
  const url = `${restUrl}/rest/v1/${probe}`
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  const SETTLED_FOR_MS = 1_000
  const deadline = Date.now() + timeoutMs
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

/** The app's tables, discovered rather than listed — a new migration is covered for free. */
async function appTables(pool: SqlRunner): Promise<string[]> {
  const { rows } = await pool.query(`select tablename from pg_tables where schemaname = 'public'`)
  return (rows as { tablename: string }[]).map((r) => r.tablename)
}

let cachedTables: string[] | null = null

/**
 * Empties every app table, leaving the schema (and the auth accounts, which
 * live in GoTrue's own schema and are created once per run) alone.
 *
 * One TRUNCATE rather than a delete per table: it ignores foreign-key order,
 * so this does not need to know that files hang off places hang off zones.
 */
export async function resetData(pool: SqlRunner): Promise<void> {
  cachedTables ??= await appTables(pool)
  if (!cachedTables.length) return
  const list = cachedTables.map((t) => `public."${t}"`).join(', ')
  // storage.objects too: a file row without its blob (or the reverse) is a
  // state the app never produces, and would make the files tests lie.
  await pool.query(`truncate ${list}, storage.objects restart identity cascade`)
}

/**
 * Marks an account's address unconfirmed.
 *
 * GoTrue refuses to issue a token for an unconfirmed address, so the only way
 * to hold one is the way a real person does: confirm, sign in, and have the
 * confirmation withdrawn afterwards. That is the account shape the invitation
 * rules care about — anyone can type someone else's email at sign-up.
 */
export async function unconfirmEmail(pool: SqlRunner, userId: string): Promise<void> {
  // Only email_confirmed_at: confirmed_at is generated from it.
  await pool.query(`update auth.users set email_confirmed_at = null where id = $1`, [userId])
}
