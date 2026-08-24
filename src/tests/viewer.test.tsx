// What a viewer sees: the same content, none of the buttons that change it,
// and none of the bookings their membership withholds.
//
// The server enforces all of this independently — see server/tests/visibility.
// Here the viewer is a real member with the flags off, signed in for real, so
// the screens are reading what the API actually sends them: these cases check
// that a viewer is never *offered* an action that would just fail, and that a
// withheld category reads as "not shared" rather than as "empty".
//
// This replaces the guest-code view. The narrow set of flags below is exactly
// what that fixed view granted; the difference is that it is now per member,
// so an owner can widen any of it.
import { beforeEach, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OWNER_USER, VIEWER_USER } from '../../server/testing/fixture'
import { ACCESS_CODE_KEY } from '../api/client'
import { Layout } from '../components/Layout'
import CategoryList from '../pages/CategoryList'
import Journey from '../pages/Journey'
import PlaceDetail from '../pages/PlaceDetail'
import ShoppingItemDetail from '../pages/ShoppingItem'
import ShoppingList from '../pages/ShoppingList'
import Zone from '../pages/Zone'
import { insert, signInAs } from './data'
import { renderAt } from './helpers'

/** What the router feeds the contexts, from `my_role` and `shows` on the bundle. */
const viewer = {
  tripRole: 'viewer' as const,
  shows: { stays: false, flight: false, documents: false, shopping: false },
}

/** The friend, on trip-1, shown none of the bookings. */
async function asNarrowViewer() {
  await insert('trip_members', [
    {
      trip_id: 'trip-1',
      user_id: VIEWER_USER.id,
      role: 'viewer',
      can_see_stays: false,
      can_see_flight: false,
      can_see_documents: false,
      can_see_shopping: false,
    },
  ])
  signInAs(VIEWER_USER)
}

describe('viewer — places', () => {
  it('shows a place and its tips without edit, delete or files', async () => {
    await asNarrowViewer()
    renderAt(
      '/trips/trip-1/places/place-ramen',
      [{ path: '/trips/:tripId/places/:placeId', element: <PlaceDetail /> }],
      viewer
    )

    // everything worth reading is still there
    expect(await screen.findByText('Ramen Bar')).toBeInTheDocument()
    expect(screen.getByText(/A very long description/)).toBeInTheDocument()
    expect(screen.getByText('Cash only')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Directions/ })).toBeInTheDocument()

    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Attach a file/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add tip' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add to a day' })).not.toBeInTheDocument()
  })

  it('still offers edit and files to the travelers', async () => {
    renderAt('/trips/trip-1/places/place-ramen', [
      { path: '/trips/:tripId/places/:placeId', element: <PlaceDetail /> },
    ])

    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument()
    // more than one: the page's button plus the confirm dialog's
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Files')).toBeInTheDocument()
  })
})

describe('viewer — zones', () => {
  it('browses a zone without the add-place or files sections', async () => {
    await asNarrowViewer()
    renderAt(
      '/trips/trip-1/zones/zone-tokyo',
      [{ path: '/trips/:tripId/zones/:zoneId', element: <Zone /> }],
      viewer
    )

    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    expect(screen.getByTestId('category-food')).toBeInTheDocument()
    expect(screen.getByText('Get a Suica card')).toBeInTheDocument()
    // The stay in this zone is withheld, so its category is not offered at all.
    expect(screen.queryByTestId('category-hotel')).not.toBeInTheDocument()

    expect(screen.queryByRole('link', { name: '+ Add place' })).not.toBeInTheDocument()
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
  })

  it('drops the "+ Add" link on a category list', async () => {
    await asNarrowViewer()
    renderAt(
      '/trips/trip-1/zones/zone-tokyo/c/food',
      [{ path: '/trips/:tripId/zones/:zoneId/c/:category', element: <CategoryList /> }],
      viewer
    )

    expect(await screen.findByText('Food & Cafés')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '+ Add' })).not.toBeInTheDocument()
  })
})

describe('viewer — shopping', () => {
  /** The list is shared with this one; the rest still is not. */
  const shopper = { ...viewer, shows: { ...viewer.shows, shopping: true } }

  async function asShoppingViewer() {
    await insert('trip_members', [
      {
        trip_id: 'trip-1',
        user_id: VIEWER_USER.id,
        role: 'viewer',
        can_see_stays: false,
        can_see_flight: false,
        can_see_documents: false,
        can_see_shopping: true,
      },
    ])
    signInAs(VIEWER_USER)
  }

  it('reads the list without adding or ticking items off', async () => {
    await asShoppingViewer()
    renderAt(
      '/trips/trip-1/shopping',
      [{ path: '/trips/:tripId/shopping', element: <ShoppingList /> }],
      shopper
    )

    expect(await screen.findByText('Onitsuka Tiger Mexico 66')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '+ Add' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Mark Onitsuka Tiger Mexico 66 as bought/ })
    ).not.toBeInTheDocument()
  })

  it('reads an item without the bought / edit / delete actions', async () => {
    await asShoppingViewer()
    renderAt(
      '/trips/trip-1/shopping/shop-shoes',
      [{ path: '/trips/:tripId/shopping/:itemId', element: <ShoppingItemDetail /> }],
      shopper
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
  const journeyRoute = [{ path: '/trips/:tripId', element: <Journey /> }]

  it('counts down without the booking reference or the legs', async () => {
    await asNarrowViewer()
    renderAt('/trips/trip-1', journeyRoute, viewer)

    expect(await screen.findByText(/keep the flight details private/)).toBeInTheDocument()
    // The fixture trip really does carry these; the API withheld them.
    expect(screen.queryByText('TESTREF')).not.toBeInTheDocument()
    expect(screen.queryByText('TA 1')).not.toBeInTheDocument()
    // and it isn't told to go looking in a Documents tab it doesn't have
    expect(screen.queryByText(/attach a booking in Documents/)).not.toBeInTheDocument()
  })

  it('still shows the travelers the whole ticket', async () => {
    renderAt('/trips/trip-1', journeyRoute)

    expect(await screen.findByText('TESTREF')).toBeInTheDocument()
    expect(screen.getByText('TA 1')).toBeInTheDocument()
  })

  it('explains the empty stays list instead of calling it unsaved', async () => {
    await asNarrowViewer()
    renderAt(
      '/trips/trip-1/zones/zone-tokyo/c/hotel',
      [{ path: '/trips/:tripId/zones/:zoneId/c/:category', element: <CategoryList /> }],
      viewer
    )

    expect(await screen.findByText('The travellers keep the stays private.')).toBeInTheDocument()
  })

  it('explains a refused stay page rather than offering a retry', async () => {
    await asNarrowViewer()
    // place-hotel is a stay, and this viewer is not shown stays — the 403 is
    // the API's, not one arranged here.
    renderAt(
      '/trips/trip-1/places/place-hotel',
      [{ path: '/trips/:tripId/places/:placeId', element: <PlaceDetail /> }],
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

  beforeEach(() => {
    // A browser that signed in before accounts still holds this key; signing
    // out is where it finally goes.
    localStorage.setItem('trip_role', 'guest')
  })

  it('drops the session and goes back to the gate', async () => {
    signInAs(VIEWER_USER)
    renderAt('/trips/trip-1', routes, viewer)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    // confirmed, not instant — the header button is easy to catch by accident
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Sign out?')
    expect(screen.getByText(/sign in again to get back in/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('gate screen')).toBeInTheDocument()
    expect(localStorage.getItem(ACCESS_CODE_KEY)).toBeNull()
    expect(localStorage.getItem('trip_role')).toBeNull()
  })

  it('keeps the session when the confirmation is cancelled', async () => {
    signInAs(VIEWER_USER)
    const token = localStorage.getItem(ACCESS_CODE_KEY)
    renderAt('/trips/trip-1', routes, viewer)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('gate screen')).not.toBeInTheDocument()
    expect(localStorage.getItem(ACCESS_CODE_KEY)).toBe(token)
  })

  it('is offered to the travelers too', async () => {
    signInAs(OWNER_USER)
    renderAt('/trips/trip-1', routes)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByText(/need to sign in again to get back in/)).toBeInTheDocument()
  })
})
