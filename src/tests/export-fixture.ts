// One export payload, shaped exactly as `GET /export` returns it, for the web
// tests. The server-side equivalent lives in `server/tests/fixture.ts`; this is
// deliberately a hand-written copy of the *response*, so a change to the wire
// shape breaks the client tests rather than being absorbed by them.
import type { ExportPayload } from '../api/types'

/** The share version: three fields per place, no days, no prose. */
export const sharePayload = (): ExportPayload => ({
  detail: 'share',
  generated_at: '2026-08-28T12:00:00.000Z',
  trip: {
    title: 'Test Trip',
    start_date: '2026-10-01',
    end_date: '2026-10-14',
    country: 'Japan',
  },
  steps: [
    {
      start_date: '2026-10-05',
      end_date: '2026-10-09',
      zone: {
        name: 'Tokyo',
        places: [
          {
            id: 'place-ramen',
            zone_id: 'zone-tokyo',
            name: 'Ramen Bar',
            address: 'Shinjuku',
            category: 'food',
          },
          // No address: listed by name, and counted in stats (FR-018).
          {
            id: 'place-hotel',
            zone_id: 'zone-tokyo',
            name: 'Test Hotel',
            address: '',
            category: 'hotel',
          },
        ],
      },
    },
    // A stop with nothing saved in it: an honest empty section, not a
    // missing one.
    { start_date: '2026-10-09', end_date: '2026-10-12', zone: { name: 'Kyoto', places: [] } },
  ],
  days: [],
  stats: { place_count: 2, places_without_address: 1, day_count: 0, included_stays: true },
})

/** The full version: the same trip with everything the traveller typed. */
export const fullPayload = (): ExportPayload => ({
  ...sharePayload(),
  detail: 'full',
  trip: { ...sharePayload().trip, description: 'Two weeks, two cities.' },
  steps: [
    {
      start_date: '2026-10-05',
      end_date: '2026-10-09',
      zone: {
        name: 'Tokyo',
        summary: 'Big city',
        tips: ['Get a Suica card'],
        places: [
          {
            id: 'place-ramen',
            zone_id: 'zone-tokyo',
            name: 'Ramen Bar',
            address: 'Shinjuku',
            category: 'food',
            description: 'Queue before noon.',
            links: [{ label: 'Site', url: 'https://example.com' }],
            tips: ['Cash only'],
          },
          {
            id: 'place-hotel',
            zone_id: 'zone-tokyo',
            name: 'Test Hotel',
            address: '',
            category: 'hotel',
          },
        ],
      },
    },
    { start_date: '2026-10-09', end_date: '2026-10-12', zone: { name: 'Kyoto', places: [] } },
  ],
  days: [
    {
      day: '2026-10-06',
      items: [
        { start_time: '20:00', title: 'Ramen Bar', highlight: false, place_name: 'Ramen Bar' },
        { title: 'Walk Shinjuku', note: 'After dinner', highlight: false },
      ],
    },
  ],
  stats: { place_count: 2, places_without_address: 1, day_count: 1, included_stays: true },
})

/**
 * A trip roughly three times the size of the real one — ~120 places across a
 * dozen stops (SC-003). The seed data has 39 places and 9 zones and cannot
 * exercise pagination, a contents listing that runs past one entry, or page
 * numbers that reach three digits.
 */
export function longTripPayload(stops = 12, placesPerStop = 10): ExportPayload {
  const steps = Array.from({ length: stops }, (_, s) => ({
    start_date: `2026-10-${String(s + 1).padStart(2, '0')}`,
    end_date: `2026-10-${String(s + 2).padStart(2, '0')}`,
    zone: {
      name: `Stop ${s + 1}`,
      summary: `Two nights in stop ${s + 1}.`,
      tips: [`Tip for stop ${s + 1}`],
      places: Array.from({ length: placesPerStop }, (_, p) => ({
        name: `Place ${s + 1}-${p + 1}`,
        // Long enough to wrap, which is what makes the row heights vary and
        // the page breaks worth testing at all.
        address: `${p + 1} Some Long Street Name, District ${s + 1}, Prefecture`,
        category: (['food', 'attraction', 'shopping', 'hotel', 'other'] as const)[p % 5],
        description: `Notes about place ${s + 1}-${p + 1}, long enough to wrap onto a second line.`,
        links: [{ label: 'Site', url: `https://example.com/${s + 1}/${p + 1}` }],
        tips: [`Go early to ${s + 1}-${p + 1}`],
      })),
    },
  }))

  return {
    detail: 'full',
    generated_at: '2026-08-28T12:00:00.000Z',
    trip: {
      title: 'A Very Long Trip',
      start_date: '2026-10-01',
      end_date: '2026-10-14',
      country: 'Japan',
    },
    steps,
    days: Array.from({ length: stops }, (_, d) => ({
      day: `2026-10-${String(d + 1).padStart(2, '0')}`,
      items: [{ start_time: '09:00', title: `Day ${d + 1} plan`, highlight: false }],
    })),
    stats: {
      place_count: stops * placesPerStop,
      places_without_address: 0,
      day_count: stops,
      included_stays: true,
    },
  }
}
