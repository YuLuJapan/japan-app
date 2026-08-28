// `show-map`, and what it has to remove.
//
// Mirrors `export-flag.test.tsx`, with one difference the map needs: the flag
// gates the *route* too, not only the entry point. The export's endpoint stays
// live behind its flag because gating it would only add a way for an
// authorised request to fail; the map has no endpoint of its own, so closing
// the route costs nothing and closes the bookmark, the pasted link and the
// back button into a session where the flag has since gone off (FR-015,
// SC-010).
//
// The second half is the tab bar, and the thing worth proving is that the
// labels shorten *as a consequence of there being six*, not as a separate
// change — which is what makes turning the flag off a total rollback (R8).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Layout } from '../components/Layout'
import { renderAt } from './helpers'

const flag = vi.hoisted(() => ({ on: false }))
vi.mock('../lib/flags', () => ({ useBooleanFlag: () => flag.on }))

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

beforeEach(() => {
  flag.on = false
  mocks.get.mockResolvedValue({
    trip: { id: 'trip-1', name: 'Test Trip', country: 'Japan' },
    steps: [],
    trip_files_count: 0,
    my_role: 'owner',
    shows: { stays: true, flight: true, documents: true, shopping: true },
  })
})

const bar = (on: boolean) => {
  flag.on = on
  renderAt('/trips/trip-1', [{ path: '/trips/:tripId', element: <Layout>{null}</Layout> }])
}

describe('with show-map off', () => {
  it('offers no tab', () => {
    bar(false)
    expect(screen.queryByRole('link', { name: /Map/ })).toBeNull()
  })

  it('leaves the five long labels exactly as they are', () => {
    bar(false)
    for (const label of ['Journey', 'Shopping', 'Reminders', 'Essentials', 'Documents']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})

describe('with show-map on', () => {
  it('adds the sixth tab', () => {
    bar(true)
    expect(screen.getByRole('link', { name: /Map/ })).toHaveAttribute('href', '/trips/trip-1/map')
  })

  it('shortens three labels, because there are now six (FR-012)', () => {
    bar(true)
    expect(screen.getByText('Alerts')).toBeInTheDocument()
    expect(screen.getByText('Info')).toBeInTheDocument()
    expect(screen.getByText('Docs')).toBeInTheDocument()
    // The three that were already short are untouched — renaming them at six
    // would be a change nobody asked for.
    expect(screen.getByText('Journey')).toBeInTheDocument()
    expect(screen.getByText('Shopping')).toBeInTheDocument()
    expect(screen.getByText('Map')).toBeInTheDocument()
  })

  it('keeps the long labels for a member whose view already drops a tab', () => {
    flag.on = true
    renderAt('/trips/trip-1', [{ path: '/trips/:tripId', element: <Layout>{null}</Layout> }], {
      tripRole: 'viewer',
      shows: { stays: true, flight: true, documents: false, shopping: true },
    })
    // Five tabs even with the map on: Journey, Map, Shopping, Reminders,
    // Essentials. The bar is not crowded, so the words do not shrink.
    expect(screen.getByText('Reminders')).toBeInTheDocument()
    expect(screen.getByText('Essentials')).toBeInTheDocument()
    expect(screen.queryByText('Alerts')).toBeNull()
  })
})

describe('the guard behind the tab', () => {
  it('sends a bookmarked /map back to the trip while the flag is off', async () => {
    const { RequireMap } = await import('../router')
    flag.on = false
    renderAt('/trips/trip-1/map', [
      { path: '/trips/:tripId/map', element: <RequireMap /> },
      { path: '/trips/:tripId', element: <p>The trip</p> },
    ])
    expect(await screen.findByText('The trip')).toBeInTheDocument()
  })
})
