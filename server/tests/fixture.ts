// Small deterministic dataset for API tests (independent of placeholder-data.json).
import type { MemoryData } from '../src/lib/datastore.memory.js'

export const TEST_CODE = 'test-code'

export function fixture(): MemoryData {
  return {
    trip: {
      id: 'trip-1',
      name: 'Test Trip',
      start_date: '2026-10-05',
      end_date: '2026-10-12',
      description: null,
    },
    steps: [
      { id: 'step-2', trip_id: 'trip-1', zone_id: 'zone-kyoto', position: 2, start_date: '2026-10-09', end_date: '2026-10-12' },
      { id: 'step-1', trip_id: 'trip-1', zone_id: 'zone-tokyo', position: 1, start_date: '2026-10-05', end_date: '2026-10-09' },
    ],
    zones: [
      { id: 'zone-tokyo', name: 'Tokyo', name_ja: '東京', summary: 'Big city' },
      { id: 'zone-kyoto', name: 'Kyoto', name_ja: '京都', summary: 'Old capital' },
    ],
    places: [
      {
        id: 'place-ramen',
        zone_id: 'zone-tokyo',
        category: 'food',
        name: 'Ramen Bar',
        name_ja: null,
        description: 'A very long description that should be trimmed into a summary line for lists, exceeding one hundred characters in total length for the test.',
        address: 'Shinjuku',
        links: [{ label: 'Site', url: 'https://example.com' }],
      },
      {
        id: 'place-hotel',
        zone_id: 'zone-tokyo',
        category: 'hotel',
        name: 'Test Hotel',
        name_ja: null,
        description: null,
        address: null,
        links: [],
      },
    ],
    tips: [
      { id: 'tip-zone', zone_id: 'zone-tokyo', place_id: null, body: 'Get a Suica card' },
      { id: 'tip-place', zone_id: null, place_id: 'place-ramen', body: 'Cash only' },
    ],
    files: [
      {
        id: 'file-trip',
        trip_id: 'trip-1',
        zone_id: null,
        place_id: null,
        display_name: 'Flight booking',
        storage_path: 'placeholder-files/flight-booking.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1000,
      },
      {
        id: 'file-place',
        trip_id: null,
        zone_id: null,
        place_id: 'place-ramen',
        display_name: 'Menu photo',
        storage_path: 'placeholder-files/kyoto-walking-map.svg',
        mime_type: 'image/svg+xml',
        size_bytes: 500,
      },
      {
        id: 'file-gone',
        trip_id: null,
        zone_id: 'zone-kyoto',
        place_id: null,
        display_name: 'Missing map',
        storage_path: 'placeholder-files/does-not-exist.pdf',
        mime_type: 'application/pdf',
        size_bytes: 100,
      },
    ],
  }
}
