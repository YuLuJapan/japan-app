// Arranging the database for a web test.
//
// The components fetch from the real API, so a test says what it needs by
// writing rows rather than by deciding what a stubbed client should return.
// Everything here goes in on top of the fixture the setup file has just
// re-seeded.
import { createClient } from '@supabase/supabase-js'
import { inject } from 'vitest'
import { SERVICE_KEY } from '../../server/testing/stack-config'

/** The service-key client — bypasses RLS, as the API's own store does. */
export const db = createClient(inject('supabaseUrl'), SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const fail = (what: string, message?: string) => {
  throw new Error(`${what} failed: ${message ?? 'unknown error'}`)
}

/** Change one row, found by its primary key. */
export async function patchRow(
  table: string,
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await db.from(table).update(patch).eq('id', id)
  if (error) fail(`patching ${table} ${id}`, error.message)
}

/** Change the seeded trip — its name, country, travellers, dates. */
export const patchTrip = (id: string, patch: Record<string, unknown>) =>
  patchRow('trips', id, patch)

/** Add rows to a table. Column defaults apply to keys a row omits. */
export async function insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  const { error } = await db.from(table).insert(rows as never, { defaultToNull: false })
  if (error) fail(`inserting into ${table}`, error.message)
}

/** Remove rows a case wants gone — the fixture's stops, say, or its places. */
export async function remove(table: string, column: string, value: string): Promise<void> {
  const { error } = await db.from(table).delete().eq(column, value)
  if (error) fail(`clearing ${table}`, error.message)
}

/** Read rows back, to assert that something the UI did really landed. */
export async function rows<T>(table: string, column: string, value: string): Promise<T[]> {
  const { data, error } = await db.from(table).select('*').eq(column, value)
  if (error) fail(`reading ${table}`, error.message)
  return (data ?? []) as T[]
}
