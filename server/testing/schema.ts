// Getting a freshly booted Postgres into the shape the app expects, and back
// to a known state between tests.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

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
export async function applyMigrations(pool: Pool): Promise<void> {
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    try {
      await pool.query(sql)
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`)
    }
  }
  // PostgREST caches the schema and would keep answering 404 for tables it did
  // not know about at boot. It watches for DDL, but asking explicitly removes
  // the race between "migrations finished" and "the first test queried".
  await pool.query(`notify pgrst, 'reload schema'`)
}

/** The app's tables, discovered rather than listed — a new migration is covered for free. */
async function appTables(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`
  )
  return rows.map((r) => r.tablename)
}

let cachedTables: string[] | null = null

/**
 * Empties every app table, leaving the schema (and the auth accounts, which
 * live in GoTrue's own schema and are created once per run) alone.
 *
 * One TRUNCATE rather than a delete per table: it ignores foreign-key order,
 * so this does not need to know that files hang off places hang off zones.
 */
export async function resetData(pool: Pool): Promise<void> {
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
export async function unconfirmEmail(pool: Pool, userId: string): Promise<void> {
  // Only email_confirmed_at: confirmed_at is generated from it.
  await pool.query(`update auth.users set email_confirmed_at = null where id = $1`, [userId])
}
