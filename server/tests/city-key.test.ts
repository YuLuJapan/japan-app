// The sibling key, as a table. Pure — no server, no store, no HTTP.
//
// This is what decides whether two stops are the same city, so a wrong answer
// either pools two visits back together or splits one city into two that can
// never be moved between. Both are silent.
import { describe, expect, it } from 'vitest'
import { cityKeyFor } from '../src/lib/city-key.js'

describe('cityKeyFor', () => {
  it.each([
    ['Tokyo', 'tokyo'],
    ['tokyo', 'tokyo'],
    ['TOKYO', 'tokyo'],
    ['  Tokyo  ', 'tokyo'],
    ['Fujikawaguchiko', 'fujikawaguchiko'],
    ['New  York', 'new york'],
    ['New\tYork', 'new york'],
  ])('%j → %j', (name, expected) => {
    expect(cityKeyFor(name)).toBe(expected)
  })

  it('reads an empty name as "no siblings" rather than as a key everything shares', () => {
    // A key of '' would make every unnamed zone a sibling of every other one,
    // and offer to move places between two cities that have nothing to do with
    // each other. Null is the same answer a city visited once gives.
    expect(cityKeyFor('')).toBeNull()
    expect(cityKeyFor('   ')).toBeNull()
  })

  it('treats case and spacing as the only differences that are never meaningful', () => {
    // "tokyo " and "Tokyo" are one city — a traveller typing a trailing space
    // must not end up with two. Anything beyond that is left alone.
    expect(cityKeyFor('tokyo ')).toBe(cityKeyFor('Tokyo'))
  })

  it('does not transliterate — deciding two spellings are one city is a guess', () => {
    // Merging these would silently pool two visits the traveller named
    // differently, and there is no way back from that without knowing which
    // rows came from where.
    expect(cityKeyFor('Kyōto')).not.toBe(cityKeyFor('Kyoto'))
    expect(cityKeyFor('東京')).not.toBe(cityKeyFor('Tokyo'))
  })
})

describe('the seeded zones', () => {
  it('agree with the migration backfill for every name in the trip', async () => {
    // supabase/migrations/0023_zone_city_key.sql backfills with
    // lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')). A zone created by
    // the app and one backfilled by the migration have to land on the same
    // key, or two visits of one city quietly stop being siblings.
    const { default: data } = await import('../src/data/placeholder-data.json', {
      with: { type: 'json' },
    })
    const zones = data.zones as { name: string; city_key?: string | null }[]
    expect(zones.length).toBeGreaterThan(0)
    for (const zone of zones) expect(zone.city_key).toBe(cityKeyFor(zone.name))
  })
})
