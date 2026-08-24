// Loading server/src/data/placeholder-data.json into a Supabase project.
//
// Shared by `npm run seed` / `npm run seed:files` (which point at whatever
// project .env.local names) and by the local stack (`npm run local:up`), so a
// developer's machine and the deployed database are filled from one definition
// rather than two that drift.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PlaceholderFile {
  storage_path: string
  mime_type: string
  display_name: string
}

interface PlaceholderData {
  trips: { id: string }[]
  zones: unknown[]
  steps: unknown[]
  places: unknown[]
  tips: unknown[]
  itinerary?: unknown[]
  shopping?: unknown[]
  reminders?: unknown[]
  files: PlaceholderFile[]
}

const root = process.cwd()

export function placeholderData(): PlaceholderData {
  const file = path.join(root, 'server/src/data/placeholder-data.json')
  return JSON.parse(readFileSync(file, 'utf-8')) as PlaceholderData
}

/** Upserted by primary key, so re-running syncs the current file. FK-safe order. */
function tablesInOrder(data: PlaceholderData): [string, unknown[]][] {
  return [
    ['trips', data.trips],
    ['zones', data.zones],
    ['journey_steps', data.steps],
    ['places', data.places],
    ['tips', data.tips],
    ['itinerary_items', data.itinerary ?? []],
    ['shopping_items', data.shopping ?? []],
    ['reminders', data.reminders ?? []],
    ['files', data.files],
  ]
}

export type SeedLogger = (line: string) => void

/** Writes every row of the placeholder data. Idempotent. */
export async function seedRows(db: SupabaseClient, log: SeedLogger = console.log): Promise<void> {
  const data = placeholderData()
  for (const [table, rows] of tablesInOrder(data)) {
    if (!rows.length) {
      log(`- ${table}: nothing to seed`)
      continue
    }
    // defaultToNull: false sends `Prefer: missing=default`, so a key a row
    // simply does not have takes the column's default instead of NULL. A bulk
    // insert otherwise normalises every row to the union of their keys — which
    // put NULL into itinerary_items.highlight for the 156 of 189 rows that do
    // not set it, and that column is NOT NULL.
    const { error } = await db
      .from(table)
      .upsert(rows as never, { onConflict: 'id', defaultToNull: false })
    if (error) throw new Error(`${table}: ${error.message}`)
    log(`✓ ${table}: ${rows.length} rows`)
  }
}

/**
 * Uploads the blob behind each file row from `public/<storage_path>`.
 *
 * A row whose local file is missing is skipped rather than fatal: the sample
 * documents are placeholders, and someone swapping in the real ones one at a
 * time should not be blocked by the ones they have not got to yet.
 */
export async function seedBlobs(
  db: SupabaseClient,
  bucket: string,
  log: SeedLogger = console.log
): Promise<void> {
  for (const file of placeholderData().files ?? []) {
    let bytes: Buffer
    try {
      bytes = readFileSync(path.join(root, 'public', file.storage_path))
    } catch {
      log(`! skip ${file.storage_path} — no local file at public/${file.storage_path}`)
      continue
    }
    const { error } = await db.storage
      .from(bucket)
      .upload(file.storage_path, bytes, { contentType: file.mime_type, upsert: true })
    if (error) throw new Error(`${file.storage_path}: ${error.message}`)
    log(`✓ uploaded ${file.storage_path} (${file.display_name})`)
  }
}
