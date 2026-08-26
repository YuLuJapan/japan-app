// Analytics is optional infrastructure, and the interesting case is the one
// where it is switched off: a fresh clone, CI, a preview deploy. The generated
// integration made a missing key fatal — it threw at module load, which took
// out 15 test files and blanked `npm run dev` — so these pin down that an
// unconfigured build stays silent rather than crashing or calling into an
// uninitialised client.
//
// The rest cover what an event is allowed to *say*: the trip context that makes
// events groupable (per country, per phase), and the guard that keeps trip
// content out of the properties even when a call site asks for it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sanitizeProperties } from '../lib/analytics-events'
import type { Trip } from '../api/types'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('posthog-js', () => ({ default: mocks }))

/** Re-import the module with the env of this test — it reads the key at load. */
async function loadWith(key?: string, host?: string, keyVar = 'VITE_POSTHOG_PROJECT_TOKEN') {
  vi.resetModules()
  vi.stubEnv('VITE_POSTHOG_PROJECT_TOKEN', '')
  vi.stubEnv('VITE_POSTHOG_KEY', '')
  vi.stubEnv(keyVar, key ?? '')
  vi.stubEnv('VITE_POSTHOG_HOST', host ?? '')
  return import('../lib/posthog')
}

const trip = (over: Partial<Trip> = {}): Trip => ({
  id: 'trip-1',
  name: 'Our honeymoon',
  country: 'Japan',
  display_title: 'Japan',
  start_date: '2026-04-01',
  end_date: '2026-04-10',
  description: null,
  people: [{ name: 'A' }, { name: 'B' }],
  local_currency: 'JPY',
  home_currencies: ['USD'],
  start_time: null,
  start_tz: null,
  ...over,
})

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockClear())
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('analytics with no key configured', () => {
  it('imports without throwing', async () => {
    await expect(loadWith(undefined)).resolves.toBeDefined()
  })

  it('reports itself disabled, so main.tsx skips the provider', async () => {
    const { posthogKey, analyticsEnabled } = await loadWith(undefined)
    expect(posthogKey).toBeNull()
    expect(analyticsEnabled).toBe(false)
  })

  it('never calls the client — an uninitialised posthog would warn on every event', async () => {
    const lib = await loadWith(undefined)
    lib.capture('place_created', {
      category: 'food',
      has_address: false,
      has_coords: false,
      has_photo: false,
      links: 0,
    })
    lib.identify('user-1', { email: 'a@b.c' })
    lib.setTripContext(lib.tripContext(trip(), 'owner'))
    lib.setTripContext(null)
    lib.captureError(new Error('boom'), 'query')
    lib.reset()
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.identify).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
    expect(mocks.unregister).not.toHaveBeenCalled()
    expect(mocks.captureException).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
  })
})

describe('analytics with a key configured', () => {
  it('passes events straight through', async () => {
    const { capture, identify, reset } = await loadWith('phc_test')
    capture('install_hint_shown', { platform: 'ios' })
    identify('user-1', { email: 'a@b.c' })
    reset()
    expect(mocks.capture).toHaveBeenCalledWith('install_hint_shown', { platform: 'ios' })
    expect(mocks.identify).toHaveBeenCalledWith('user-1', { email: 'a@b.c' })
    expect(mocks.reset).toHaveBeenCalled()
  })

  it('sends a property-less event with no properties at all', async () => {
    const { capture } = await loadWith('phc_test')
    capture('shopping_item_deleted')
    expect(mocks.capture).toHaveBeenCalledWith('shopping_item_deleted')
  })

  it('captures a pageview per route change, not just per page load', async () => {
    // Legacy `capture_pageview: true` means "once, on load", which in a
    // createBrowserRouter app is one $pageview per cold start and nothing for
    // the navigation after it. The dated defaults are what make it
    // 'history_change'; dropping this line silently loses all navigation.
    const { posthogOptions } = await loadWith('phc_test')
    expect(posthogOptions.defaults).toBe('2026-05-30')
  })

  it('keeps trip content out of PostHog', async () => {
    // Autocapture sends the text of whatever was clicked — here, reservation
    // details and the shopping list, where an item *is* the present. Session
    // recording is off for the same reason. Both are privacy decisions.
    const { posthogOptions } = await loadWith('phc_test')
    expect(posthogOptions.autocapture).toBe(false)
    expect(posthogOptions.disable_session_recording).toBe(true)
  })

  it('accepts either env var name — the docs use one, the wizard writes the other', async () => {
    // Getting this wrong sends nothing at all while the app looks perfectly
    // healthy, which is exactly how it went unnoticed the first time.
    const fromDocs = await loadWith('phc_docs', undefined, 'VITE_POSTHOG_PROJECT_TOKEN')
    expect(fromDocs.posthogKey).toBe('phc_docs')
    const fromWizard = await loadWith('phc_wizard', undefined, 'VITE_POSTHOG_KEY')
    expect(fromWizard.posthogKey).toBe('phc_wizard')
  })

  it('falls back to the US host when none is given', async () => {
    const { posthogOptions } = await loadWith('phc_test')
    expect(posthogOptions.api_host).toBe('https://us.i.posthog.com')
  })
})

describe('the property guard', () => {
  it('keeps the shapes an event is made of', () => {
    const { properties, problems } = sanitizeProperties({
      category: 'hotel',
      links: 2,
      has_photo: false,
      trip_country: null,
      fields: ['end_date', 'start_date'],
    })
    expect(problems).toEqual([])
    expect(properties).toEqual({
      category: 'hotel',
      links: 2,
      has_photo: false,
      trip_country: null,
      fields: ['end_date', 'start_date'],
    })
  })

  it('drops a key that names trip content, however innocent the call site', () => {
    // `{ name: place.name }` is the reflex this exists to stop — on a hotel
    // that name is half the reservation.
    const { properties, problems } = sanitizeProperties({
      category: 'hotel',
      name: 'Hoshinoya Kyoto',
      note: 'confirmation 4471',
    })
    expect(properties).toEqual({ category: 'hotel' })
    expect(problems).toHaveLength(2)
  })

  it('drops free text that slipped in under a harmless key', () => {
    const { properties, problems } = sanitizeProperties({
      reason: 'x'.repeat(65),
      code: 'VALIDATION',
    })
    expect(properties).toEqual({ code: 'VALIDATION' })
    expect(problems).toHaveLength(1)
  })

  it('drops anything that is not a value — an object is a whole record', () => {
    const { properties, problems } = sanitizeProperties({
      place: { id: 'p1', name: 'secret' },
      count: 1,
    })
    expect(properties).toEqual({ count: 1 })
    expect(problems).toHaveLength(1)
  })

  it('omits undefined rather than sending null for "not set"', () => {
    const { properties, problems } = sanitizeProperties({ bought: undefined, fields: ['bought'] })
    expect(properties).toEqual({ fields: ['bought'] })
    expect(problems).toEqual([])
  })

  it('still sends the event when a property is rejected', async () => {
    // A save must never fail because an analytics property was wrong.
    const { capture } = await loadWith('phc_test')
    const properties = { category: 'food', name: 'Ichiran' } as unknown as {
      category: 'food'
      fields: string[]
    }
    capture('place_updated', properties)
    expect(mocks.capture).toHaveBeenCalledWith('place_updated', { category: 'food' })
  })
})

describe('trip context', () => {
  it('describes the trip without identifying it', async () => {
    const { tripFacts } = await loadWith('phc_test')
    expect(tripFacts(trip(), new Date('2026-03-01T00:00:00Z'))).toEqual({
      trip_country: 'japan',
      trip_destination: 'japan',
      trip_length_days: 10,
      trip_travellers: 2,
      trip_local_currency: 'JPY',
      trip_phase: 'upcoming',
    })
  })

  it('groups the country however it was typed', async () => {
    const { tripFacts } = await loadWith('phc_test')
    expect(tripFacts(trip({ country: '  JAPAN ' })).trip_country).toBe('japan')
  })

  it('separates elsewhere from nowhere in particular', async () => {
    const { tripFacts } = await loadWith('phc_test')
    expect(tripFacts(trip({ country: 'Portugal' })).trip_destination).toBe('other')
    expect(tripFacts(trip({ country: null })).trip_destination).toBe('unknown')
    expect(tripFacts(trip({ country: null })).trip_country).toBeNull()
  })

  it('says where the trip is relative to today', async () => {
    const { tripFacts } = await loadWith('phc_test')
    const phase = (now: string) => tripFacts(trip(), new Date(now)).trip_phase
    expect(phase('2026-03-31T12:00:00')).toBe('upcoming')
    expect(phase('2026-04-05T12:00:00')).toBe('active')
    expect(phase('2026-04-10T12:00:00')).toBe('active') // the last day is still the trip
    expect(phase('2026-04-11T12:00:00')).toBe('past')
  })

  it('registers the open trip so every later event carries it', async () => {
    const { setTripContext, tripContext } = await loadWith('phc_test')
    setTripContext(tripContext(trip(), 'viewer'))
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ trip_id: 'trip-1', trip_role: 'viewer', trip_country: 'japan' })
    )
  })

  it('clears every key it registered — a stale country would relabel the next trip', async () => {
    const { setTripContext, tripContext } = await loadWith('phc_test')
    const registered = Object.keys(tripContext(trip(), 'owner'))
    setTripContext(null)
    const cleared = mocks.unregister.mock.calls.map(([key]) => key)
    expect(cleared.sort()).toEqual(registered.sort())
  })
})

describe('error reporting', () => {
  /**
   * `loadWith` resets the module registry, so lib/posthog gets its own copy of
   * api/client — and `instanceof ApiError` only holds for the class from that
   * same copy. Take both from one load, or every error looks like a plain one.
   */
  const load = async () => {
    const lib = await loadWith('phc_test')
    const { ApiError } = await import('../api/client')
    return { ...lib, ApiError }
  }

  it('says which route failed, with the ids taken out', async () => {
    const { errorProperties, ApiError } = await load()
    const error = new ApiError(
      500,
      'INTERNAL',
      'Boom',
      undefined,
      'PATCH',
      '/trips/8f14e45f-0000-4000-8000-000000000000/places/abc?x=1'
    )
    expect(errorProperties(error, 'mutation')).toMatchObject({
      source: 'mutation',
      status: 500,
      code: 'INTERNAL',
      method: 'PATCH',
      path: '/trips/:id/places/abc',
      network: false,
    })
  })

  it('marks a failure that never left the phone', async () => {
    const { errorProperties, ApiError } = await load()
    const props = errorProperties(new ApiError(0, 'NETWORK', 'No connection'), 'query')
    expect(props).toMatchObject({ status: 0, code: 'NETWORK', network: true })
  })

  it('never carries the message — a 500 can say anything at all', async () => {
    const { errorProperties, ApiError } = await load()
    const props = errorProperties(
      new ApiError(400, 'VALIDATION', 'name must not be empty'),
      'query'
    )
    expect(JSON.stringify(props)).not.toContain('name must not be empty')
  })

  it('reports a caught failure as an exception, so it lands with the crashes', async () => {
    const { captureError, ApiError } = await load()
    captureError(new ApiError(503, 'INTERNAL', 'Down', undefined, 'POST', '/trips'), 'mutation')
    expect(mocks.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: 'mutation', status: 503, path: '/trips' })
    )
  })

  it("does not report a request failure under the server's own wording", async () => {
    // `captureException` sends the message too, and a 500's message is the
    // server's to write — so an API failure is reported as its safe parts.
    const { captureError, ApiError } = await load()
    const message = 'could not save “Hoshinoya Kyoto”'
    captureError(new ApiError(500, 'INTERNAL', message, undefined, 'POST', '/trips'), 'mutation')
    const [reported] = mocks.captureException.mock.calls[0]
    expect(reported.message).not.toContain('Hoshinoya')
    expect(reported.message).toContain('500 INTERNAL')
    expect(reported.message).toContain('POST /trips')
  })

  it('passes a real JS error through — there the message and stack are the report', async () => {
    const { captureError } = await load()
    const bug = new TypeError('x.map is not a function')
    captureError(bug, 'query')
    expect(mocks.captureException).toHaveBeenCalledWith(
      bug,
      expect.objectContaining({
        source: 'query',
        code: 'TypeError',
      })
    )
  })
})
