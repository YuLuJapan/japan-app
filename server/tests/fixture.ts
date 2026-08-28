// Small deterministic dataset for API tests (independent of placeholder-data.json).
import type { MemoryData } from '../src/lib/datastore.memory.js'

/** Accounts the tests sign in as. `OUTSIDER` is a real, valid account that is
 *  a member of nothing — the shape every new signup arrives in. */
export const OWNER_USER = {
  id: 'user-yuval',
  email: 'yuval@example.com',
  display_name: 'Yuval',
  avatar_url: null,
}
export const PARTNER_USER = {
  id: 'user-sam',
  email: 'sam@example.com',
  display_name: 'Sam',
  avatar_url: null,
}
export const OUTSIDER_USER = {
  id: 'user-outsider',
  email: 'outsider@example.com',
  display_name: 'Outsider',
  avatar_url: null,
}
/** A friend the trip is shared with, read-only. Visibility set per test. */
export const VIEWER_USER = {
  id: 'user-friend',
  email: 'friend@example.com',
  display_name: 'Friend',
  avatar_url: null,
}

export function fixture(): MemoryData {
  return {
    profiles: [OWNER_USER, PARTNER_USER, OUTSIDER_USER, VIEWER_USER],
    members: [
      {
        trip_id: 'trip-1',
        user_id: OWNER_USER.id,
        role: 'owner',
        can_see_stays: true,
        can_see_flight: true,
        can_see_documents: true,
        can_see_shopping: true,
      },
      // A second tenant, so "does not leak across trips" can be asserted
      // against real data rather than an empty database.
      {
        trip_id: 'trip-2',
        user_id: PARTNER_USER.id,
        role: 'owner',
        can_see_stays: true,
        can_see_flight: true,
        can_see_documents: true,
        can_see_shopping: true,
      },
    ],
    trips: [
      {
        id: 'trip-1',
        name: 'Test Trip',
        country: 'Japan',
        start_date: '2026-10-01',
        end_date: '2026-10-14',
        description: null,
        people: [{ name: 'Alex' }, { name: 'Sam' }],
        local_currency: 'JPY',
        home_currencies: ['USD', 'ILS'],
        start_time: null,
        start_tz: null,
        flight: {
          airline: 'Test Air',
          booking_ref: 'TESTREF',
          outbound: {
            depart_at: '2026-10-01T08:00:00+03:00',
            depart_tz: 'Asia/Jerusalem',
            arrive_at: '2026-10-02T06:00:00+09:00',
            arrive_tz: 'Asia/Tokyo',
            legs: [{ flight_no: 'TA 1', from: 'Tel Aviv (TLV)', to: 'Narita (NRT)' }],
          },
          return_flight: {
            depart_at: '2026-10-14T10:00:00+09:00',
            depart_tz: 'Asia/Tokyo',
            arrive_at: '2026-10-14T18:00:00+03:00',
            arrive_tz: 'Asia/Jerusalem',
            legs: [{ flight_no: 'TA 2', from: 'Narita (NRT)', to: 'Tel Aviv (TLV)' }],
          },
        },
      },
      {
        id: 'trip-2',
        name: 'Someone Else’s Trip',
        country: 'Italy',
        start_date: '2026-11-01',
        end_date: '2026-11-10',
        description: null,
        people: [{ name: 'Sam' }],
        // Italy, so euros in and dollars out — the second trip is where the
        // currency choice is exercised (trip-1 keeps the JPY→USD/ILS default).
        local_currency: 'EUR',
        home_currencies: ['USD'],
        start_time: null,
        start_tz: null,
        // No booking attached — what every trip looks like until someone adds one.
        flight: null,
      },
    ],
    steps: [
      {
        id: 'step-other',
        trip_id: 'trip-2',
        zone_id: 'zone-osaka',
        position: 1,
        start_date: '2026-11-02',
        end_date: '2026-11-06',
      },
      {
        id: 'step-2',
        trip_id: 'trip-1',
        zone_id: 'zone-kyoto',
        position: 2,
        start_date: '2026-10-09',
        end_date: '2026-10-12',
      },
      {
        id: 'step-1',
        trip_id: 'trip-1',
        zone_id: 'zone-tokyo',
        position: 1,
        start_date: '2026-10-05',
        end_date: '2026-10-09',
      },
    ],
    zones: [
      { id: 'zone-tokyo', trip_id: 'trip-1', name: 'Tokyo', name_ja: '東京', summary: 'Big city' },
      {
        id: 'zone-kyoto',
        trip_id: 'trip-1',
        name: 'Kyoto',
        name_ja: '京都',
        summary: 'Old capital',
      },
      {
        id: 'zone-osaka',
        trip_id: 'trip-2',
        name: 'Osaka',
        name_ja: '大阪',
        summary: 'Someone else’s city',
      },
    ],
    places: [
      {
        id: 'place-ramen',
        zone_id: 'zone-tokyo',
        category: 'food',
        name: 'Ramen Bar',
        name_ja: null,
        description:
          'A very long description that should be trimmed into a summary line for lists, exceeding one hundred characters in total length for the test.',
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
      // Every field a place has, populated — the fixture the export's exclusion
      // tests are only meaningful against. A share projection of this row must
      // emit exactly name, address and category; anything else showing up here
      // is a field that joined the share export without a decision (FR-011).
      {
        id: 'place-everything',
        zone_id: 'zone-kyoto',
        category: 'attraction',
        name: 'Fushimi Inari',
        name_ja: '伏見稲荷大社',
        description: 'Go before 7am. We paid ¥0 — it is free, but the tea house is not.',
        address: '68 Fukakusa Yabunouchicho, Fushimi Ward',
        links: [
          { label: 'Official', url: 'https://inari.jp' },
          { label: 'Map', url: 'https://maps.example.com/inari' },
        ],
        image_url: 'https://example.com/inari.jpg',
        lat: 34.9671,
        lng: 135.7727,
      },
      // A stay carrying exactly what the share version exists to keep out. The
      // three words are what server/tests/export.test.ts greps the whole
      // serialised payload for.
      {
        id: 'place-ryokan',
        zone_id: 'zone-kyoto',
        category: 'hotel',
        name: 'Kyoto Ryokan',
        name_ja: null,
        description:
          'Booking on Rakuten, confirmation RYO-99231. The reservation covers two nights, breakfast included.',
        address: '3 Higashiyama, Kyoto',
        links: [{ label: 'Booking', url: 'https://example.com/reservation/RYO-99231' }],
      },
      {
        id: 'place-other',
        zone_id: 'zone-osaka',
        category: 'hotel',
        name: 'Secret Osaka Hotel',
        name_ja: null,
        description: 'Confirmation ABC123, paid ¥40000',
        address: null,
        links: [],
      },
    ],
    tips: [
      { id: 'tip-zone', zone_id: 'zone-tokyo', place_id: null, body: 'Get a Suica card' },
      { id: 'tip-place', zone_id: null, place_id: 'place-ramen', body: 'Cash only' },
      { id: 'tip-kyoto', zone_id: 'zone-kyoto', place_id: null, body: 'Buy a bus day pass' },
      // Hangs off a stay, so it must disappear exactly when the stay does.
      { id: 'tip-ryokan', zone_id: null, place_id: 'place-ryokan', body: 'Check in after 15:00' },
      { id: 'tip-other', zone_id: 'zone-osaka', place_id: null, body: 'Secret Osaka plan' },
    ],
    itinerary: [
      {
        id: 'itin-ramen',
        trip_id: 'trip-1',
        zone_id: 'zone-tokyo',
        place_id: 'place-ramen',
        day: '2026-10-06',
        start_time: '20:00',
        title: 'Ramen Bar',
        note: null,
        position: 0,
        highlight: false,
        icon: null,
        category: null,
      },
      {
        id: 'itin-walk',
        trip_id: 'trip-1',
        zone_id: 'zone-tokyo',
        place_id: null,
        day: '2026-10-06',
        start_time: null,
        title: 'Walk Shinjuku',
        note: 'After dinner',
        position: 0,
        highlight: false,
        icon: null,
        category: null,
      },
      // Points at a stay: a caller who cannot see stays keeps the row and loses
      // the link, the way the itinerary service already treats place_id.
      {
        id: 'itin-ryokan',
        trip_id: 'trip-1',
        zone_id: 'zone-kyoto',
        place_id: 'place-ryokan',
        day: '2026-10-10',
        start_time: '15:00',
        title: 'Check into the ryokan',
        note: null,
        position: 0,
        highlight: false,
        icon: null,
        category: null,
      },
    ],
    shopping: [
      {
        id: 'shop-shoes',
        trip_id: 'trip-1',
        name: 'Onitsuka Tiger Mexico 66',
        category: 'clothes',
        note: 'Size 42',
        shop: 'Onitsuka Tiger Ginza',
        zone_id: 'zone-tokyo',
        price_yen: 12000,
        url: null,
        image_url: null,
        bought: false,
        position: 0,
      },
      {
        id: 'shop-shampoo',
        trip_id: 'trip-1',
        name: 'Ichikami shampoo',
        category: 'haircare',
        note: null,
        shop: 'Don Quijote',
        zone_id: null,
        price_yen: 900,
        url: null,
        image_url: null,
        bought: true,
        position: 0,
      },
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

/**
 * The same trip at roughly three times real size — ~120 places across a dozen
 * stops (SC-003). The seed data has 39 places across 9 zones, which fits
 * comfortably and therefore proves nothing about a trip that does not.
 *
 * Built on top of `fixture()` so the small, hand-written rows the other tests
 * assert against are all still there; this only adds.
 */
export function largeFixture(stops = 12, placesPerStop = 10): MemoryData {
  const data = fixture()
  for (let s = 0; s < stops; s++) {
    const zoneId = `zone-big-${s}`
    data.zones.push({
      id: zoneId,
      trip_id: 'trip-1',
      name: `Stop ${s + 1}`,
      name_ja: null,
      summary: `Two nights in stop ${s + 1}.`,
    })
    data.steps.push({
      id: `step-big-${s}`,
      trip_id: 'trip-1',
      zone_id: zoneId,
      position: 10 + s,
      start_date: '2026-10-01',
      end_date: '2026-10-02',
    })
    data.tips.push({ id: `tip-big-${s}`, zone_id: zoneId, place_id: null, body: `Tip ${s + 1}` })
    for (let p = 0; p < placesPerStop; p++) {
      const placeId = `place-big-${s}-${p}`
      data.places.push({
        id: placeId,
        zone_id: zoneId,
        category: (['food', 'attraction', 'shopping', 'hotel', 'other'] as const)[p % 5],
        name: `Place ${s + 1}-${p + 1}`,
        name_ja: null,
        description: `Notes about place ${s + 1}-${p + 1}.`,
        // Every fifth place has no address, so the count in `stats` is
        // exercised at a size where a miscount would not be obvious.
        address: p % 5 === 0 ? null : `${p + 1} Some Long Street, District ${s + 1}`,
        links: [{ label: 'Site', url: `https://example.com/${s}/${p}` }],
      })
      data.tips.push({
        id: `tip-big-${s}-${p}`,
        zone_id: null,
        place_id: placeId,
        body: `Go early to ${s + 1}-${p + 1}`,
      })
    }
  }
  return data
}
