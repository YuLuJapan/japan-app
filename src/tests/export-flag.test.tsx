// `export-trip`, and what it has to hide.
//
// The flag is the interesting half, the same way it is for `files-rename`: off
// has to leave the trip home exactly as it was, and it has to reach further
// than the button — the payload prefetch is a network call made on behalf of a
// screen nobody can open, and a bookmark is a way in that no missing link
// closes. A dark feature is one nobody can find, not one that is merely
// inconvenient to reach.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import Journey from '../pages/Journey'
import { renderAt } from './helpers'

const flag = vi.hoisted(() => ({ on: false }))
vi.mock('../lib/flags', () => ({ useBooleanFlag: () => flag.on }))

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const bundle = () => ({
  trip: {
    id: 'trip-1',
    name: 'Test Trip',
    display_title: 'Test Trip',
    country: 'Japan',
    start_date: '2026-10-01',
    end_date: '2026-10-14',
    start_time: null,
    start_tz: null,
    description: null,
    people: [],
    local_currency: 'JPY',
    home_currencies: ['USD'],
  },
  steps: [
    {
      id: 'step-1',
      start_date: '2026-10-05',
      end_date: '2026-10-09',
      position: 1,
      zone: { id: 'zone-tokyo', name: 'Tokyo', image_url: null },
    },
  ],
  trip_files_count: 0,
  my_role: 'owner',
  shows: { stays: true, flight: true, documents: true, shopping: true },
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve(bundle())
    if (path === '/trips/trip-1/itinerary') return Promise.resolve({ items: [] })
    if (path.includes('/export')) return Promise.resolve({ export: null })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
})

afterEach(() => {
  vi.useRealTimers()
  mocks.get.mockReset()
})

/** Render the trip home and let the deferred prefetch fire. */
async function journey(on: boolean) {
  flag.on = on
  renderAt('/trips/trip-1', [{ path: '/trips/:tripId', element: <Journey /> }])
  await screen.findByRole('heading', { name: 'The journey' })
  await act(async () => {
    // Past the prefetch's deferral (research R4 defers it past first paint).
    vi.advanceTimersByTime(3000)
  })
}

const exportFetches = () =>
  mocks.get.mock.calls.map(([path]) => String(path)).filter((path) => path.includes('/export'))

describe('with export-trip off', () => {
  it('offers no way in from the trip home', async () => {
    await journey(false)
    expect(screen.queryByRole('link', { name: 'Export' })).toBeNull()
    // The rest of the home screen is untouched — off means invisible, not broken.
    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Day by day' })).toBeInTheDocument()
  })

  it('warms no export payload', async () => {
    await journey(false)
    // Two requests on behalf of a screen nobody can open would be two requests
    // wasted on every trip home, for every account, for as long as the flag is
    // off.
    expect(exportFetches()).toEqual([])
  })
})

describe('with export-trip on', () => {
  it('offers the link, and warms both detail levels for the offline case', async () => {
    await journey(true)
    expect(screen.getByRole('link', { name: 'Export' })).toHaveAttribute(
      'href',
      '/trips/trip-1/export'
    )
    // Both levels: the screen cannot know which button is coming, and a
    // payload fetched once is the whole of the offline guarantee (SC-004).
    expect(exportFetches()).toEqual([
      '/trips/trip-1/export?detail=share&ids=1',
      '/trips/trip-1/export?detail=full&ids=1',
    ])
  })
})

describe('the guard behind the link', () => {
  it('sends a bookmarked /export back to the trip while the flag is off', async () => {
    const { RequireExport } = await import('../router')
    flag.on = false
    renderAt(
      '/trips/trip-1/export',
      [
        {
          path: '/trips/:tripId/export',
          element: <RequireExport />,
        },
        { path: '/trips/:tripId', element: <p>The trip</p> },
      ],
      { tripRole: 'owner' }
    )
    // A missing link closes the front door; this closes the others — a
    // bookmark, a pasted link, a back button into a session where the flag has
    // since gone off.
    expect(await screen.findByText('The trip')).toBeInTheDocument()
  })
})
