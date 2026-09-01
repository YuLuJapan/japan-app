// What a viewer sees: the same content, none of the buttons that change it,
// and none of the bookings their membership withholds.
//
// The server enforces all of this independently — see server/tests/visibility.
// These check that a viewer is never *offered* an action that would just fail,
// and that a withheld category reads as "not shared" rather than as "empty".
//
// This replaces the guest-code view. The narrow set of flags below is exactly
// what that fixed view granted; the difference is that it is now per member,
// so an owner can widen any of it.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../api/client'
import { Layout } from '../components/Layout'
import CategoryList from '../pages/CategoryList'
import Journey from '../pages/Journey'
import ActivityDetail from '../pages/ActivityDetail'
import ShoppingItemDetail from '../pages/ShoppingItem'
import ShoppingList from '../pages/ShoppingList'
import Zone from '../pages/Zone'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const viewer = {
  tripRole: 'viewer' as const,
  shows: { stays: false, flight: false, documents: false, shopping: false },
}

const place = {
  activity: {
    id: 'p1',
    zone_id: 'zone-1',
    category: 'attraction',
    name: 'Fushimi Inari',
    name_ja: '伏見稲荷大社',
    description: 'The thousand torii gates.',
    address: 'Fushimi-ku, Kyoto',
    links: [],
  },
  tips: [{ id: 't1', body: 'Sunrise visit — no crowds' }],
  files: [],
}

const zone = {
  zone: { id: 'zone-1', name: 'Tokyo', name_ja: '東京', summary: 'Big city' },
  tips: [{ id: 't1', body: 'Get a Suica card' }],
  files: [],
  saved_counts: { hotel: 0, attraction: 2, food: 1, shopping: 0, other: 0 },
}

const shoppingItem = {
  id: 'buy-1',
  trip_id: 'trip-1',
  name: 'Onitsuka Tiger Mexico 66',
  category: 'clothes',
  price_yen: 12000,
  shop: 'Onitsuka Ginza',
  zone_id: null,
  url: null,
  note: null,
  image_url: null,
  bought: false,
  position: 0,
}

/** One mock for every query the shopping screens make. */
function mockShoppingApi() {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1/shopping') return Promise.resolve({ items: [shoppingItem] })
    if (path.startsWith('/rates'))
      return Promise.resolve({
        base: 'JPY',
        date: '2026-08-01',
        rates: { USD: 0.0067, ILS: 0.025 },
        missing: [],
      })
    if (path === '/trips/trip-1')
      return Promise.resolve({
        trip: {
          id: 'trip-1',
          name: 'Japan',
          country: 'Japan',
          display_title: 'Japan',
          start_date: '2026-09-19',
          end_date: '2026-10-16',
          description: null,
          people: [],
        },
        steps: [],
      })
    return Promise.resolve({})
  })
}

describe('viewer — activities', () => {
  it('shows a place and its tips without edit, delete or files', async () => {
    mocks.get.mockResolvedValue(place)
    renderAt(
      '/trips/trip-1/activities/p1',
      [{ path: '/trips/:tripId/activities/:activityId', element: <ActivityDetail /> }],
      viewer
    )

    // everything worth reading is still there
    expect(await screen.findByText('Fushimi Inari')).toBeInTheDocument()
    expect(screen.getByText('The thousand torii gates.')).toBeInTheDocument()
    expect(screen.getByText('Sunrise visit — no crowds')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Directions/ })).toBeInTheDocument()

    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Attach a file/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add tip' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add to a day' })).not.toBeInTheDocument()
  })

  it('still offers edit and files to the travelers', async () => {
    mocks.get.mockResolvedValue(place)
    renderAt('/trips/trip-1/activities/p1', [
      { path: '/trips/:tripId/activities/:activityId', element: <ActivityDetail /> },
    ])

    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument()
    // more than one: the page's button plus the confirm dialog's
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Files')).toBeInTheDocument()
  })
})

describe('viewer — zones', () => {
  it('browses a zone without the add-place or files sections', async () => {
    mocks.get.mockResolvedValue(zone)
    renderAt(
      '/trips/trip-1/zones/zone-1',
      [{ path: '/trips/:tripId/zones/:zoneId', element: <Zone /> }],
      viewer
    )

    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    expect(screen.getByTestId('category-attraction')).toBeInTheDocument()
    expect(screen.getByText('Get a Suica card')).toBeInTheDocument()

    expect(screen.queryByRole('link', { name: '+ Add' })).not.toBeInTheDocument()
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
  })

  it('drops the "+ Add" link on a category list', async () => {
    mocks.get.mockResolvedValue({ activities: [], zone: zone.zone })
    renderAt(
      '/trips/trip-1/zones/zone-1/c/food',
      [{ path: '/trips/:tripId/zones/:zoneId/c/:category', element: <CategoryList /> }],
      viewer
    )

    expect(await screen.findByText('Food & cafés')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '+ Add' })).not.toBeInTheDocument()
  })
})

describe('viewer — shopping', () => {
  it('reads the list without adding or ticking items off', async () => {
    mockShoppingApi()
    renderAt(
      '/trips/trip-1/shopping',
      [{ path: '/trips/:tripId/shopping', element: <ShoppingList /> }],
      viewer
    )

    expect(await screen.findByText('Onitsuka Tiger Mexico 66')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '+ Add' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Mark Onitsuka Tiger Mexico 66 as bought/ })
    ).not.toBeInTheDocument()
  })

  it('reads an item without the bought / edit / delete actions', async () => {
    mockShoppingApi()
    renderAt(
      '/trips/trip-1/shopping/buy-1',
      [{ path: '/trips/:tripId/shopping/:itemId', element: <ShoppingItemDetail /> }],
      viewer
    )

    expect(await screen.findByText('Onitsuka Tiger Mexico 66')).toBeInTheDocument()
    expect(screen.getByText('¥12,000')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as bought' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})

// The API sends such a viewer no stays and no flight at all; these check the
// screens say so instead of looking broken or empty.
describe('viewer — stays and flight', () => {
  const tripBundle = (flight?: unknown) => ({
    trip: {
      id: 'trip-1',
      name: 'Japan',
      country: 'Japan',
      display_title: 'Japan',
      start_date: '2026-09-19',
      end_date: '2026-10-16',
      description: null,
      people: [{ name: 'Yuval' }, { name: 'Luciana' }],
    },
    steps: [],
    trip_files_count: 0,
    ...(flight ? { flight } : {}),
  })

  const flight = {
    airline: 'Ethiopian Airlines',
    booking_ref: 'ABC123',
    outbound: {
      depart_at: '2026-09-18T15:35:00+03:00',
      depart_tz: 'Asia/Jerusalem',
      arrive_at: '2026-09-19T19:40:00+09:00',
      arrive_tz: 'Asia/Tokyo',
      legs: [{ flight_no: 'ET 419', from: 'Tel Aviv (TLV)', to: 'Narita (NRT)' }],
    },
    return_flight: {
      depart_at: '2026-10-16T20:40:00+09:00',
      depart_tz: 'Asia/Tokyo',
      arrive_at: '2026-10-17T14:35:00+03:00',
      arrive_tz: 'Asia/Jerusalem',
      legs: [{ flight_no: 'ET 418', from: 'Narita (NRT)', to: 'Tel Aviv (TLV)' }],
    },
  }

  const journeyRoute = [{ path: '/trips/:tripId', element: <Journey /> }]

  it('counts down without the booking reference or the legs', async () => {
    mocks.get.mockImplementation((path: string) =>
      Promise.resolve(path === '/trips/trip-1' ? tripBundle() : { items: [] })
    )
    renderAt('/trips/trip-1', journeyRoute, viewer)

    expect(await screen.findByText(/keep the flight details private/)).toBeInTheDocument()
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument()
    expect(screen.queryByText('ET 419')).not.toBeInTheDocument()
    // and it isn't told to go looking in a Documents tab it doesn't have
    expect(screen.queryByText(/attach a booking in Documents/)).not.toBeInTheDocument()
  })

  it('still shows the travelers the whole ticket', async () => {
    mocks.get.mockImplementation((path: string) =>
      Promise.resolve(path === '/trips/trip-1' ? tripBundle(flight) : { items: [] })
    )
    renderAt('/trips/trip-1', journeyRoute)

    // The card opens collapsed now, so the reference and the legs are one tap
    // in — the point here is that a traveller is offered them at all.
    fireEvent.click(await screen.findByText('Tap here to see the flight details'))
    expect(screen.getByText('ABC123')).toBeInTheDocument()
    expect(screen.getByText('ET 419')).toBeInTheDocument()
  })

  it('explains the empty stays list instead of calling it unsaved', async () => {
    mocks.get.mockResolvedValue({ activities: [], zone: zone.zone })
    renderAt(
      '/trips/trip-1/zones/zone-1/c/hotel',
      [{ path: '/trips/:tripId/zones/:zoneId/c/:category', element: <CategoryList /> }],
      viewer
    )

    expect(await screen.findByText('The travellers keep the stays private.')).toBeInTheDocument()
  })

  it('explains a refused stay page rather than offering a retry', async () => {
    mocks.get.mockRejectedValue(
      new ApiError(403, 'FORBIDDEN', 'Where this trip is staying is not shared with you')
    )
    renderAt(
      '/trips/trip-1/activities/hotel-1',
      [{ path: '/trips/:tripId/activities/:activityId', element: <ActivityDetail /> }],
      viewer
    )

    expect(await screen.findByText('The travellers keep the stays private.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})

describe('viewer — navigation', () => {
  const layoutRoute = [{ path: '/trips/:tripId', element: <Layout>content</Layout> }]

  it('drops the tabs it is not shown and says it is view-only', () => {
    renderAt('/trips/trip-1', layoutRoute, viewer)

    expect(screen.queryByRole('link', { name: /Documents/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Shopping/ })).not.toBeInTheDocument()
    expect(screen.getByText('View only')).toBeInTheDocument()
    // the rest of the app is still reachable
    for (const tab of ['Journey', 'Reminders', 'Essentials']) {
      expect(screen.getByRole('link', { name: new RegExp(tab) })).toBeInTheDocument()
    }
  })

  // The two flags are independent: read-only says nothing about which sections
  // are shared, so a viewer with the shopping list keeps its tab.
  it('keeps the Shopping tab when the list is shared with them', () => {
    renderAt('/trips/trip-1', layoutRoute, {
      ...viewer,
      shows: { ...viewer.shows, shopping: true },
    })

    expect(screen.getByRole('link', { name: /Shopping/ })).toBeInTheDocument()
  })

  it('keeps the Documents tab for the travelers', () => {
    renderAt('/trips/trip-1', layoutRoute)

    expect(screen.getByRole('link', { name: /Documents/ })).toBeInTheDocument()
    expect(screen.queryByText('View only')).not.toBeInTheDocument()
  })
})

describe('signing out', () => {
  const routes = [
    { path: '/trips/:tripId', element: <Layout>content</Layout> },
    { path: '/gate', element: <p>gate screen</p> },
  ]

  beforeEach(() => localStorage.clear())

  it('drops the session and goes back to the gate', async () => {
    localStorage.setItem('trip_access_code', 'a.jwt')
    // A browser that signed in before accounts still holds this key; signing
    // out is where it finally goes.
    localStorage.setItem('trip_role', 'guest')
    renderAt('/trips/trip-1', routes, viewer)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    // confirmed, not instant — the header button is easy to catch by accident
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Sign out?')
    expect(screen.getByText(/sign in again to get back in/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('gate screen')).toBeInTheDocument()
    expect(localStorage.getItem('trip_access_code')).toBeNull()
    expect(localStorage.getItem('trip_role')).toBeNull()
  })

  it('keeps the session when the confirmation is cancelled', async () => {
    localStorage.setItem('trip_access_code', 'a.jwt')
    renderAt('/trips/trip-1', routes, viewer)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('gate screen')).not.toBeInTheDocument()
    expect(localStorage.getItem('trip_access_code')).toBe('a.jwt')
  })

  it('is offered to the travelers too', async () => {
    localStorage.setItem('trip_access_code', 'owner-code')
    renderAt('/trips/trip-1', routes)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByText(/need to sign in again to get back in/)).toBeInTheDocument()
  })
})
