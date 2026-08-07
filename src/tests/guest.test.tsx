// The guest view: same content, none of the buttons that change it, and no
// documents anywhere. (The server enforces all of this independently — see
// server/tests/guest.test.ts. These check that a guest is never *offered* an
// action that would just fail.)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Layout } from '../components/Layout'
import CategoryList from '../pages/CategoryList'
import PlaceDetail from '../pages/PlaceDetail'
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

const guest = { role: 'guest' as const }

const place = {
  place: {
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
  place_counts: { hotel: 0, attraction: 2, food: 1, shopping: 0, other: 0 },
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
    if (path === '/shopping') return Promise.resolve({ items: [shoppingItem] })
    if (path === '/rates')
      return Promise.resolve({ base: 'JPY', date: '2026-08-01', usd: 0.0067, ils: 0.025 })
    if (path === '/trip')
      return Promise.resolve({
        trip: {
          id: 'trip-1',
          name: 'Japan',
          start_date: '2026-09-19',
          end_date: '2026-10-16',
          description: null,
        },
        steps: [],
      })
    return Promise.resolve({})
  })
}

describe('guest view — places', () => {
  it('shows a place and its tips without edit, delete or files', async () => {
    mocks.get.mockResolvedValue(place)
    renderAt('/places/p1', [{ path: '/places/:placeId', element: <PlaceDetail /> }], guest)

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
    renderAt('/places/p1', [{ path: '/places/:placeId', element: <PlaceDetail /> }])

    expect(await screen.findByRole('link', { name: 'Edit' })).toBeInTheDocument()
    // more than one: the page's button plus the confirm dialog's
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Files')).toBeInTheDocument()
  })
})

describe('guest view — zones', () => {
  it('browses a zone without the add-place or files sections', async () => {
    mocks.get.mockResolvedValue(zone)
    renderAt('/zones/zone-1', [{ path: '/zones/:zoneId', element: <Zone /> }], guest)

    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    expect(screen.getByTestId('category-attraction')).toBeInTheDocument()
    expect(screen.getByText('Get a Suica card')).toBeInTheDocument()

    expect(screen.queryByRole('link', { name: '+ Add place' })).not.toBeInTheDocument()
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
  })

  it('drops the "+ Add" link on a category list', async () => {
    mocks.get.mockResolvedValue({ places: [], zone: zone.zone })
    renderAt(
      '/zones/zone-1/c/food',
      [{ path: '/zones/:zoneId/c/:category', element: <CategoryList /> }],
      guest
    )

    expect(await screen.findByText('Food & Cafés')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '+ Add' })).not.toBeInTheDocument()
  })
})

describe('guest view — shopping', () => {
  it('reads the list without adding or ticking items off', async () => {
    mockShoppingApi()
    renderAt('/shopping', [{ path: '/shopping', element: <ShoppingList /> }], guest)

    expect(await screen.findByText('Onitsuka Tiger Mexico 66')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '+ Add' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Mark Onitsuka Tiger Mexico 66 as bought/ })
    ).not.toBeInTheDocument()
  })

  it('reads an item without the bought / edit / delete actions', async () => {
    mockShoppingApi()
    renderAt(
      '/shopping/buy-1',
      [{ path: '/shopping/:itemId', element: <ShoppingItemDetail /> }],
      guest
    )

    expect(await screen.findByText('Onitsuka Tiger Mexico 66')).toBeInTheDocument()
    expect(screen.getByText('¥12,000')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as bought' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})

describe('guest view — navigation', () => {
  it('has no Documents tab and says it is view-only', () => {
    renderAt('/', [{ path: '/', element: <Layout>content</Layout> }], guest)

    expect(screen.queryByRole('link', { name: /Documents/ })).not.toBeInTheDocument()
    expect(screen.getByText('Guest · view only')).toBeInTheDocument()
    // the rest of the app is still reachable
    for (const tab of ['Journey', 'Shopping', 'Reminders', 'Essentials']) {
      expect(screen.getByRole('link', { name: new RegExp(tab) })).toBeInTheDocument()
    }
  })

  it('keeps the Documents tab for the travelers', () => {
    renderAt('/', [{ path: '/', element: <Layout>content</Layout> }])

    expect(screen.getByRole('link', { name: /Documents/ })).toBeInTheDocument()
    expect(screen.queryByText('Guest · view only')).not.toBeInTheDocument()
  })
})

describe('signing out', () => {
  const routes = [
    { path: '/', element: <Layout>content</Layout> },
    { path: '/gate', element: <p>gate screen</p> },
  ]

  beforeEach(() => localStorage.clear())

  it('lets a guest drop the code and go back to the gate to enter another', async () => {
    localStorage.setItem('trip_access_code', 'guest-code')
    localStorage.setItem('trip_role', 'guest')
    renderAt('/', routes, guest)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    // confirmed, not instant — the header button is easy to catch by accident
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Sign out?')
    expect(screen.getByText(/travelers’ code next to be able to edit/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('gate screen')).toBeInTheDocument()
    expect(localStorage.getItem('trip_access_code')).toBeNull()
    expect(localStorage.getItem('trip_role')).toBeNull()
  })

  it('keeps the session when the confirmation is cancelled', async () => {
    localStorage.setItem('trip_access_code', 'guest-code')
    renderAt('/', routes, guest)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('gate screen')).not.toBeInTheDocument()
    expect(localStorage.getItem('trip_access_code')).toBe('guest-code')
  })

  it('is offered to the travelers too', async () => {
    localStorage.setItem('trip_access_code', 'owner-code')
    renderAt('/', routes)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByText(/need the access code to get back in/)).toBeInTheDocument()
  })
})
