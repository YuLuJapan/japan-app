// The projection, on its own — no HTTP, no store.
//
// This is the file FR-011's *runtime* half lives in. The other half is a type:
// `Record<keyof Place, ExportLevel>` in lib/export-view.ts makes a new column a
// compile error, and `npm run typecheck` is what makes that error reachable.
// The two catch different things and both are needed — a runtime test cannot
// see a field that only exists in the interface, and a type cannot see an
// accidental spread.
import { describe, expect, it } from 'vitest'
import {
  PLACE_FIELD_POLICY,
  projectExport,
  type ExportDetail,
  type ExportSource,
} from '../src/lib/export-view.js'
import { FULL_VIEW, type TripView } from '../src/lib/trip-view.js'
import { fixture } from './fixture.js'

const NO_STAYS: TripView = { ...FULL_VIEW, stays: false }

/** trip-1 out of the fixture, in the order the store hands the rows over. */
function source(): ExportSource {
  const data = fixture()
  const zones = data.zones.filter((z) => z.trip_id === 'trip-1')
  const zoneIds = new Set(zones.map((z) => z.id))
  const places = data.places.filter((p) => zoneIds.has(p.zone_id))
  const placeIds = new Set(places.map((p) => p.id))
  return {
    trip: data.trips.find((t) => t.id === 'trip-1')!,
    // The store returns the journey by start date; step-1 (Tokyo) first.
    steps: data.steps
      .filter((s) => s.trip_id === 'trip-1')
      .sort((a, b) => (a.start_date < b.start_date ? -1 : 1)),
    zones,
    places,
    tips: data.tips!.filter(
      (t) => (t.zone_id && zoneIds.has(t.zone_id)) || (t.place_id && placeIds.has(t.place_id))
    ),
    itinerary: (data.itinerary ?? []).filter((i) => i.trip_id === 'trip-1'),
    generated_at: '2026-08-28T12:00:00.000Z',
  }
}

const project = (view: TripView, detail: ExportDetail) => projectExport(view, source(), { detail })

/** Every place in the payload, flattened out of the journey. */
const places = (payload: ReturnType<typeof project>) => payload.steps.flatMap((s) => s.zone.places)

const find = (payload: ReturnType<typeof project>, name: string) =>
  places(payload).find((p) => p.name === name)

describe('the share projection', () => {
  it('emits exactly name, address and category for a place with every field set', () => {
    const place = find(project(FULL_VIEW, 'share'), 'Fushimi Inari')
    // The fixture row carries name_ja, a description, two links, an image and
    // coordinates. None of them may reach a share file — and this asserts the
    // whole key set rather than the absence of the ones we thought of, so a
    // field promoted by an accidental spread fails here too (research R6).
    expect(place && Object.keys(place).sort()).toEqual(['address', 'category', 'name'])
    expect(place).toEqual({
      name: 'Fushimi Inari',
      address: '68 Fukakusa Yabunouchicho, Fushimi Ward',
      category: 'attraction',
    })
  })

  it('carries the journey, its zones and its dates', () => {
    const payload = project(FULL_VIEW, 'share')
    expect(payload.steps.map((s) => s.zone.name)).toEqual(['Tokyo', 'Kyoto'])
    expect(payload.steps[0]).toMatchObject({ start_date: '2026-10-05', end_date: '2026-10-09' })
    expect(payload.trip).toEqual({
      title: 'Test Trip',
      start_date: '2026-10-01',
      end_date: '2026-10-14',
      country: 'Japan',
    })
  })

  it('carries no tip, no zone summary, no trip description and no day plan', () => {
    const payload = project(FULL_VIEW, 'share')
    for (const step of payload.steps) {
      expect(step.zone.tips).toBeUndefined()
      expect(step.zone.summary).toBeUndefined()
    }
    expect(payload.days).toEqual([])
    expect(payload.stats.day_count).toBe(0)
    expect(payload.trip.description).toBeUndefined()
  })

  it('includes stays whole — nothing that makes one sensitive survives the projection', () => {
    const ryokan = find(project(FULL_VIEW, 'share'), 'Kyoto Ryokan')
    expect(ryokan).toEqual({
      name: 'Kyoto Ryokan',
      address: '3 Higashiyama, Kyoto',
      category: 'hotel',
    })
  })

  it('lists a place with no address by name, and counts it', () => {
    const payload = project(FULL_VIEW, 'share')
    const hotel = find(payload, 'Test Hotel')
    // Listed, with an empty address rather than dropped or left as a blank row.
    expect(hotel).toEqual({ name: 'Test Hotel', address: '', category: 'hotel' })
    expect(payload.stats.places_without_address).toBe(1)
    expect(payload.stats.place_count).toBe(4)
  })
})

describe('the full projection', () => {
  it('adds descriptions, links, zone summaries and tips', () => {
    const payload = project(FULL_VIEW, 'full')
    const inari = find(payload, 'Fushimi Inari')
    expect(inari?.description).toContain('Go before 7am')
    expect(inari?.links).toHaveLength(2)

    const tokyo = payload.steps[0].zone
    expect(tokyo.summary).toBe('Big city')
    expect(tokyo.tips).toEqual(['Get a Suica card'])
    expect(find(payload, 'Ramen Bar')?.tips).toEqual(['Cash only'])
  })

  it('adds the day plan, grouped by day in the store’s order', () => {
    const payload = project(FULL_VIEW, 'full')
    const sixth = payload.days.find((d) => d.day === '2026-10-06')!
    expect(sixth.items.map((i) => i.title)).toEqual(['Ramen Bar', 'Walk Shinjuku'])
    expect(sixth.items[0]).toMatchObject({
      start_time: '20:00',
      place_name: 'Ramen Bar',
      highlight: false,
    })
    expect(sixth.items[1].start_time).toBeUndefined()
    // Days carrying something — not days listed, which is the whole trip.
    expect(payload.stats.day_count).toBe(2)
  })

  it('runs the plan over every day of the trip, not only the planned ones', () => {
    const payload = project(FULL_VIEW, 'full')
    // 1–14 October inclusive: a day-by-day plan that skips the empty days is a
    // list of activities, and the gaps are what a reader plans into.
    expect(payload.days).toHaveLength(14)
    expect(payload.days[0].day).toBe('2026-10-01')
    expect(payload.days.at(-1)!.day).toBe('2026-10-14')
    expect(payload.days.map((d) => d.day)).toEqual([...payload.days.map((d) => d.day)].sort())
    // An unplanned day is listed with nothing in it.
    expect(payload.days.find((d) => d.day === '2026-10-02')).toEqual({
      day: '2026-10-02',
      zones: [],
      items: [],
    })
  })

  it('says which city each day is spent in, and names both on a moving day', () => {
    const days = project(FULL_VIEW, 'full').days
    const on = (day: string) => days.find((d) => d.day === day)?.zones
    // step-1 Tokyo 10-05→10-09, step-2 Kyoto 10-09→10-12 — they meet on the 9th.
    expect(on('2026-10-06')).toEqual(['Tokyo'])
    expect(on('2026-10-09')).toEqual(['Tokyo', 'Kyoto'])
    expect(on('2026-10-10')).toEqual(['Kyoto'])
    // Before the journey starts, no stop covers the day. That is a real gap
    // and is shown as one rather than guessed at.
    expect(on('2026-10-01')).toEqual([])
  })

  it('still carries no flight, no shopping, no document and no member name', () => {
    // FR-004a. Serialised, because the point is that none of it is anywhere in
    // the payload — not that a key we thought of is absent.
    const json = JSON.stringify(project(FULL_VIEW, 'full'))
    for (const secret of ['TESTREF', 'Test Air', 'Onitsuka', 'Flight booking', 'Alex']) {
      expect(json).not.toContain(secret)
    }
  })
})

describe('the caller’s view, applied before the field policy', () => {
  it('drops a hidden stay, its tips, and its link from the day plan', () => {
    const payload = project(NO_STAYS, 'full')
    const names = places(payload).map((p) => p.name)
    expect(names).not.toContain('Kyoto Ryokan')
    expect(names).not.toContain('Test Hotel')
    expect(names).toContain('Fushimi Inari')

    const json = JSON.stringify(payload)
    expect(json).not.toContain('Check in after 15:00') // the tip on the stay
    expect(json).not.toContain('RYO-99231')

    // The row survives, its link does not — the same treatment the itinerary
    // service already gives place_id.
    const checkIn = payload.days
      .flatMap((d) => d.items)
      .find((i) => i.title === 'Check into the ryokan')
    expect(checkIn).toBeDefined()
    expect(checkIn?.place_name).toBeUndefined()
  })

  it('says so once, in stats, and nowhere else', () => {
    const payload = project(NO_STAYS, 'share')
    expect(payload.stats.included_stays).toBe(false)
    // The stays are gone from the count too, and Kyoto keeps its section.
    expect(payload.stats.place_count).toBe(2)
    expect(payload.steps.map((s) => s.zone.name)).toEqual(['Tokyo', 'Kyoto'])
    expect(JSON.stringify(payload)).not.toMatch(/withheld|hidden|private/i)
  })

  it('reduces a hidden stay to nothing, rather than to a name and an address', () => {
    // The ordering in data-model §4 is the requirement: view first, policy
    // second. Reversed, this place would come back as three harmless-looking
    // fields — and at full detail, with its description.
    expect(find(project(NO_STAYS, 'share'), 'Kyoto Ryokan')).toBeUndefined()
    expect(find(project(NO_STAYS, 'full'), 'Kyoto Ryokan')).toBeUndefined()
  })
})

describe('identifiers', () => {
  it('are emitted only when the JSON backup asks for them', () => {
    const readable = find(project(FULL_VIEW, 'share'), 'Fushimi Inari')
    expect(readable?.id).toBeUndefined()

    const backup = projectExport(FULL_VIEW, source(), { detail: 'share', ids: true })
    const place = backup.steps
      .flatMap((s) => s.zone.places)
      .find((p) => p.id === 'place-everything')
    // Still exactly the share fields, plus the two ids: the machine-readable
    // form is not a way around the projection.
    expect(place && Object.keys(place).sort()).toEqual([
      'address',
      'category',
      'id',
      'name',
      'zone_id',
    ])
    expect(place?.zone_id).toBe('zone-kyoto')
  })

  it('are the only fields the policy marks json', () => {
    const json = Object.entries(PLACE_FIELD_POLICY)
      .filter(([, level]) => level === 'json')
      .map(([field]) => field)
      .sort()
    expect(json).toEqual(['id', 'zone_id'])
  })
})

describe('determinism', () => {
  it('produces identical content for the same rows at the same detail', () => {
    expect(JSON.stringify(project(FULL_VIEW, 'full'))).toBe(
      JSON.stringify(project(FULL_VIEW, 'full'))
    )
  })
})
