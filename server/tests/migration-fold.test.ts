// The fold rule exists twice — once as SQL (supabase/migrations/0025_activities.sql,
// which runs against the live Postgres) and once as TypeScript (scripts/fold.ts,
// which runs against server/src/data/placeholder-data.json). Two implementations of
// one rule is only honest if something notices when they drift.
//
// `fold-golden.json` is not hand-written: it is what the SQL actually produced when
// run over `fold-input.json` in Postgres 16, dumped straight out of the `activities`
// table. So this asserts the TypeScript agrees with the SQL, not with its author.
//
// Regenerate the golden after changing the migration:
//   see specs/010-activities/migration.md §5 ("It has been run").
import { describe, expect, it } from 'vitest'
import { foldActivities, strayLinks, type FoldItem, type FoldPlace } from '../../scripts/fold'
import golden from './fixtures/fold-golden.json'
import input from './fixtures/fold-input.json'

const places = input.places as FoldPlace[]
const items = input.items as FoldItem[]
const matches = input.matches as [string, string][]
const zones = new Map(input.zones.map((z) => [z.id, z.trip_id]))
const fold = () =>
  foldActivities({ places, items, matches, tripIdOfZone: (id) => zones.get(id) ?? '' })

const byId = (rows: { id: string }[]) => new Map(rows.map((r) => [r.id, r]))

describe('the fold rule agrees with the SQL that runs in production', () => {
  it('produces exactly the rows the migration produced in Postgres', () => {
    expect(fold()).toEqual(golden)
  })

  it('drops one row per fold and no others', () => {
    // Six matched pairs, but the stay never folds and one place is matched twice,
    // so four items are absorbed: 8 + 10 − 4.
    expect(fold()).toHaveLength(places.length + items.length - 4)
  })

  it('loses nothing: every source row is an activity or was folded into one', () => {
    const out = byId(fold())
    for (const place of places) expect(out.has(place.id)).toBe(true)
    const foldedAway = items.filter((i) => !out.has(i.id))
    expect(foldedAway.map((i) => i.id).sort()).toEqual(['i-differ', 'i-dupe', 'i-same', 'i-twice-a'])
    // and each of those left its words behind on the row that absorbed it
    for (const item of foldedAway) {
      const survivor = out.get(item.place_id!)!
      expect(survivor.name).toBe(item.title)
      expect(survivor.day).toBe(item.day)
    }
  })
})

describe('what the fold keeps', () => {
  it('gives a folded row the plan’s words and keeps the place’s name in the description', () => {
    const a = byId(fold()).get('p-differ')!
    expect(a.name).toBe('Fushimi Inari at sunrise')
    expect(a.description).toContain('Ten thousand gates.') // the place's own words
    expect(a.description).toContain('Go before the crowds.') // the item's note
    expect(a.description).toContain('Saved as "Fushimi Inari Shrine"') // and its name
  })

  it('does not repeat a note that is word for word the description', () => {
    const a = byId(fold()).get('p-dupe')!
    expect(a.description).toBe('Wooden stage over the hillside.')
  })

  it('adds no "Saved as" line when the item never renamed the place', () => {
    expect(byId(fold()).get('p-same')!.description).toBe('Tonkotsu, solo booths.')
  })

  it('carries the place’s schedule onto the row that kept its id', () => {
    const a = byId(fold()).get('p-differ')!
    expect([a.day, a.start_time, a.position]).toEqual(['2026-05-02', '06:30', 1])
  })
})

describe('what the fold refuses to do', () => {
  it('never gives a stay a date, so a reservation stays in Explore', () => {
    const a = byId(fold()).get('p-stay')!
    expect(a.day).toBeNull()
    expect(a.description).toBe('Booking ref XYZ123, paid.')
  })

  it('leaves an item hanging off a stay completely untouched', () => {
    // Re-tagging it `hotel` would hide "Check in" from a member whose view
    // withholds stays (FR-021) — which is not what they see today.
    const a = byId(fold()).get('i-stay')!
    expect(a.category).toBeNull()
    expect([a.address, a.lat, a.image_url]).toEqual([null, null, null])
  })

  it('gives a stray link nothing: its place_id is not a statement about where it is', () => {
    const a = byId(fold()).get('i-stray')!
    expect([a.address, a.lat, a.lng, a.category]).toEqual([null, null, null, null])
    expect(strayLinks(items, matches).map((i) => i.id)).toEqual(['i-stray'])
  })

  it('gives a copy the pin but not the record', () => {
    const a = byId(fold()).get('i-twice-b')!
    expect([a.address, a.lat]).toEqual(['Nakagyo', 35.005]) // so it pins
    expect(a.links).toEqual([]) // but a reservation link is a reservation
    expect(a.name_ja).toBeNull()
    expect(a.category).toBe('shopping') // inherited where the item had none
  })
})

describe('the invariants the migration is verified against', () => {
  const out = fold()
  it('every row has a name', () => {
    expect(out.filter((a) => !a.name?.trim())).toEqual([])
  })
  it('every saved row has a city — Explore has nowhere else to put it (FR-004)', () => {
    expect(out.filter((a) => a.day === null && a.zone_id === null)).toEqual([])
  })
  it('every highlight has a day to banner (FR-005)', () => {
    expect(out.filter((a) => a.highlight && a.day === null)).toEqual([])
  })
  it('keeps a dated row with no city working, which five rows in production need', () => {
    const a = byId(out).get('i-nozone')!
    expect([a.zone_id, a.day]).toEqual([null, '2026-05-06'])
  })
})
