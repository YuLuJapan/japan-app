import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShoppingCategoryPage from '../pages/ShoppingCategory'
import ShoppingForm from '../pages/ShoppingForm'
import ShoppingItemDetail from '../pages/ShoppingItem'
import ShoppingList from '../pages/ShoppingList'
import type { ShoppingItem } from '../api/types'
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

// The api mock is module-level, so call history would otherwise carry across
// tests — which matters for the "nothing is searched until asked" assertion.
beforeEach(() => vi.clearAllMocks())

const item = (over: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: 'buy-1',
  trip_id: 'trip-1',
  name: 'Onitsuka Tiger Mexico 66',
  category: 'clothes',
  note: 'Size 42',
  shop: 'ABC Mart',
  zone_id: 'zone-tokyo',
  price_yen: 12000,
  url: null,
  image_url: null,
  bought: false,
  position: 0,
  ...over,
})

const shampoo = item({
  id: 'buy-2',
  name: 'Ichikami shampoo',
  category: 'haircare',
  note: null,
  shop: 'Don Quijote',
  zone_id: null,
  price_yen: 900,
})

/** One fetch mock for every query the shopping pages make. */
function mockApi(items: ShoppingItem[]) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1/shopping') return Promise.resolve({ items })
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
        steps: [
          {
            id: 'step-1',
            position: 1,
            start_date: '2026-09-19',
            end_date: '2026-09-23',
            zone: {
              id: 'zone-tokyo',
              name: 'Tokyo',
              name_ja: null,
              summary: null,
              place_counts: {},
            },
          },
        ],
        trip_files_count: 0,
      })
    return Promise.resolve({})
  })
}

const shoppingListRoute = { path: '/trips/:tripId/shopping', element: <ShoppingList /> }
const renderShoppingList = () => renderAt('/trips/trip-1/shopping', [shoppingListRoute])

describe('Shopping home (category carousels)', () => {
  it('groups items into one section per category, each linking to its own page', async () => {
    mockApi([item(), shampoo])
    renderShoppingList()

    const clothes = (await screen.findByRole('heading', { name: /Clothes & shoes/ })).closest(
      'section'
    )!
    const hair = screen.getByRole('heading', { name: /Hair care/ }).closest('section')!

    // each item sits under its own category, not in one flat list
    expect(within(clothes).getByText('Onitsuka Tiger Mexico 66')).toBeInTheDocument()
    expect(within(clothes).queryByText('Ichikami shampoo')).not.toBeInTheDocument()
    expect(within(hair).getByText('Ichikami shampoo')).toBeInTheDocument()

    expect(within(clothes).getByRole('link', { name: /See all 1/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/shopping/c/clothes'
    )
    expect(within(hair).getByRole('link', { name: /See all 1/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/shopping/c/haircare'
    )
  })

  it('opens the item detail page — not the edit form — when a tile is tapped', async () => {
    mockApi([item()])
    renderShoppingList()

    expect(await screen.findByRole('link', { name: /Onitsuka Tiger/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/shopping/buy-1'
    )
  })

  it('shows progress and what is left to spend', async () => {
    mockApi([item(), item({ id: 'buy-3', name: 'Kit Kats', price_yen: 600, bought: true })])
    renderShoppingList()

    expect(await screen.findByText('1 of 2 bought')).toBeInTheDocument()
    expect(screen.getByText('¥12,600')).toBeInTheDocument() // total value of everything on the list
    expect(screen.getByText(/₪300.*still to spend/)).toBeInTheDocument()
  })

  it('ticks an item off straight from the carousel', async () => {
    mockApi([item()])
    mocks.patch.mockResolvedValue({ item: item({ bought: true }) })
    renderShoppingList()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark Onitsuka Tiger Mexico 66 as bought' })
    )
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/trips/trip-1/shopping/buy-1', { bought: true })
    )
  })

  it('renders an empty state with nothing on the list', async () => {
    mockApi([])
    renderShoppingList()

    expect(await screen.findByText(/Nothing on the list yet/)).toBeInTheDocument()
  })
})

/** The swipe surface for an item — the element carrying the touch handlers. */
async function rowFor(name: string) {
  const link = await screen.findByRole('link', { name: new RegExp(name.slice(0, 12)) })
  return link.closest('[style*="translateX"]') as HTMLElement
}

/** Drag a row by (dx, dy) in a few steps, like a finger would. */
function swipe(el: HTMLElement, dx: number, dy = 0) {
  const point = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] })
  fireEvent.touchStart(el, point(0, 0))
  for (const step of [0.34, 0.67, 1]) {
    fireEvent.touchMove(el, point(dx * step, dy * step))
  }
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: dx, clientY: dy }] })
}

const categoryRoute = {
  path: '/trips/:tripId/shopping/c/:category',
  element: <ShoppingCategoryPage />,
}
const renderCategory = (category: string) =>
  renderAt(`/trips/trip-1/shopping/c/${category}`, [categoryRoute])

describe('Shopping category page', () => {
  it('lists every item in the category and nothing else, bought ones separated', async () => {
    mockApi([
      item(),
      item({ id: 'buy-3', name: 'Uniqlo HEATTECH', price_yen: 1500, bought: true }),
      shampoo,
    ])
    renderCategory('clothes')

    expect(await screen.findByRole('heading', { name: /Clothes & shoes/ })).toBeInTheDocument()
    expect(screen.getByText('Onitsuka Tiger Mexico 66')).toBeInTheDocument()
    expect(screen.getByText('Uniqlo HEATTECH')).toBeInTheDocument()
    expect(screen.queryByText('Ichikami shampoo')).not.toBeInTheDocument() // other category

    expect(screen.getByText('To buy · 1')).toBeInTheDocument()
    expect(screen.getByText('Bought · 1')).toBeInTheDocument()
    expect(screen.getByText(/1\/2 bought/)).toBeInTheDocument()
  })

  it('ticks an item off when the row is swiped right', async () => {
    mockApi([item()])
    mocks.patch.mockResolvedValue({ item: item({ bought: true }) })
    renderCategory('clothes')

    swipe(await rowFor('Onitsuka Tiger Mexico 66'), 120)

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/trips/trip-1/shopping/buy-1', { bought: true })
    )
  })

  it('asks before deleting when the row is swiped left', async () => {
    mockApi([item()])
    mocks.delete.mockResolvedValue(undefined)
    renderCategory('clothes')

    swipe(await rowFor('Onitsuka Tiger Mexico 66'), -120)

    // the swipe alone must not delete anything
    expect(mocks.delete).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(/Delete Onitsuka Tiger Mexico 66/)

    await userEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Delete')!
    )
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/trips/trip-1/shopping/buy-1'))
  })

  it('ignores a short sideways nudge and a vertical scroll', async () => {
    mockApi([item()])
    renderCategory('clothes')
    const row = await rowFor('Onitsuka Tiger Mexico 66')

    swipe(row, 40) // too short to count
    swipe(row, 0, 150) // scrolling down the page

    expect(mocks.patch).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('adds into the category you are looking at', async () => {
    mockApi([shampoo])
    renderCategory('haircare')

    expect(await screen.findByRole('link', { name: '+ Add' })).toHaveAttribute(
      'href',
      '/trips/trip-1/shopping/new?category=haircare'
    )
  })
})

const itemRoute = { path: '/trips/:tripId/shopping/:itemId', element: <ShoppingItemDetail /> }
const renderItemDetail = (
  itemId: string,
  extraRoutes: { path: string; element: JSX.Element }[] = []
) => renderAt(`/trips/trip-1/shopping/${itemId}`, [itemRoute, ...extraRoutes])

describe('Shopping item detail', () => {
  it('shows the price, where to buy it and the notes', async () => {
    mockApi([item()])
    renderItemDetail('buy-1')

    expect(
      await screen.findByRole('heading', { name: 'Onitsuka Tiger Mexico 66' })
    ).toBeInTheDocument()
    expect(screen.getByText('¥12,000')).toBeInTheDocument()
    expect(screen.getByText(/≈ ₪300.00 ≈ \$80.40/)).toBeInTheDocument()
    expect(screen.getByText(/ABC Mart/)).toBeInTheDocument()
    expect(screen.getByText(/Tokyo/)).toBeInTheDocument()
    expect(screen.getByText('Size 42')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/trips/trip-1/shopping/buy-1/edit'
    )
  })

  it('marks the item bought from the detail page', async () => {
    mockApi([item()])
    mocks.patch.mockResolvedValue({ item: item({ bought: true }) })
    renderItemDetail('buy-1')

    await userEvent.click(await screen.findByRole('button', { name: 'Mark as bought' }))
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/trips/trip-1/shopping/buy-1', { bought: true })
    )
  })

  it('offers to put a bought item back on the list', async () => {
    mockApi([item({ bought: true })])
    renderItemDetail('buy-1')

    expect(await screen.findByRole('button', { name: 'Put back on the list' })).toBeInTheDocument()
    expect(screen.getByText('✓ Already bought')).toBeInTheDocument()
  })

  it('asks for confirmation before deleting', async () => {
    mockApi([item()])
    mocks.delete.mockResolvedValue(undefined)
    renderItemDetail('buy-1', [{ path: '/trips/:tripId/shopping', element: <p>list</p> }])

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(mocks.delete).not.toHaveBeenCalled() // dialog first

    const dialog = screen.getByRole('dialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete'
    )!
    await userEvent.click(confirm)
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/trips/trip-1/shopping/buy-1'))
  })

  it('offers a web photo search for an item that has none, and saves the pick', async () => {
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith('/images'))
        return Promise.resolve({
          results: [
            {
              url: 'https://upload.wikimedia.org/found.jpg',
              thumb_url: 'https://upload.wikimedia.org/found-thumb.jpg',
              title: 'Kit Kat',
              source: 'commons',
              source_url: null,
              credit: 'CC BY 2.0',
            },
          ],
        })
      if (path === '/trips/trip-1/shopping')
        return Promise.resolve({ items: [item({ name: 'Kit Kat', image_url: null })] })
      return Promise.resolve({ items: [], steps: [] })
    })
    mocks.patch.mockResolvedValue({
      item: item({ image_url: 'https://upload.wikimedia.org/found.jpg' }),
    })
    renderItemDetail('buy-1')

    await userEvent.click(await screen.findByRole('button', { name: /Find a photo on the web/ }))
    await userEvent.click(await screen.findByRole('img', { name: 'Kit Kat' }))

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/trips/trip-1/shopping/buy-1', {
        image_url: 'https://upload.wikimedia.org/found.jpg',
      })
    )
  })

  it('explains itself when the item is gone', async () => {
    mockApi([])
    renderItemDetail('buy-gone')

    expect(await screen.findByText(/no longer on the list/)).toBeInTheDocument()
  })
})

const newFormRoute = { path: '/trips/:tripId/shopping/new', element: <ShoppingForm /> }
const renderNewForm = (query = '', extraRoutes: { path: string; element: JSX.Element }[] = []) =>
  renderAt(`/trips/trip-1/shopping/new${query}`, [newFormRoute, ...extraRoutes])

describe('ShoppingForm', () => {
  it('creates an item with shop, price and photo, then opens its page', async () => {
    mockApi([])
    mocks.post.mockResolvedValue({ item: item({ id: 'buy-new' }) })
    renderNewForm('', [{ path: '/trips/:tripId/shopping/:itemId', element: <p>detail page</p> }])

    await userEvent.type(screen.getByLabelText('What is it? *'), 'Uniqlo HEATTECH')
    await userEvent.type(screen.getByLabelText('Where to buy it'), 'Uniqlo Ginza')
    await userEvent.type(screen.getByLabelText('Expected price (yen)'), '1500')
    await userEvent.type(screen.getByLabelText('Photo URL'), 'https://example.com/heattech.jpg')
    await userEvent.click(screen.getByRole('button', { name: 'Add to list' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/trips/trip-1/shopping',
        expect.objectContaining({
          name: 'Uniqlo HEATTECH',
          shop: 'Uniqlo Ginza',
          price_yen: 1500,
          image_url: 'https://example.com/heattech.jpg',
          bought: false,
        })
      )
    )
    expect(await screen.findByText('detail page')).toBeInTheDocument()
  })

  it('starts in the category you added from', async () => {
    mockApi([])
    renderNewForm('?category=skincare')

    expect(screen.getByLabelText('Category')).toHaveValue('skincare')
  })

  it('fills the form from a pasted product link', async () => {
    mockApi([])
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith('/product-preview'))
        return Promise.resolve({
          url: 'https://www.uniqlo.com/jp/en/products/E123',
          name: 'HEATTECH Crew Neck T-Shirt',
          image_url: 'https://www.uniqlo.com/img/heattech.jpg',
          shop: 'UNIQLO',
          price_yen: 1500,
          price_note: null,
        })
      return Promise.resolve({ items: [], steps: [] })
    })
    renderNewForm()

    await userEvent.type(
      screen.getByLabelText('Have a link? Paste it'),
      'https://www.uniqlo.com/jp/en/products/E123'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Read link' }))

    await waitFor(() =>
      expect(screen.getByLabelText('What is it? *')).toHaveValue('HEATTECH Crew Neck T-Shirt')
    )
    expect(screen.getByLabelText('Where to buy it')).toHaveValue('UNIQLO')
    expect(screen.getByLabelText('Expected price (yen)')).toHaveValue('1500')
    expect(screen.getByLabelText('Photo URL')).toHaveValue(
      'https://www.uniqlo.com/img/heattech.jpg'
    )
    expect(screen.getByLabelText('Product link')).toHaveValue(
      'https://www.uniqlo.com/jp/en/products/E123'
    )
  })

  it('shows the English name from a Japanese page and keeps the Japanese in the details', async () => {
    mockApi([])
    mocks.get.mockImplementation((path: string) =>
      path.startsWith('/product-preview')
        ? Promise.resolve({
            url: 'https://www.uniqlo.com/jp/ja/products/E1',
            name: 'Crew Neck T-Shirt',
            name_ja: 'クルーネックT（半袖）',
            image_url: null,
            shop: 'UNIQLO',
            price_yen: 1500,
            price_note: null,
          })
        : Promise.resolve({ items: [], steps: [] })
    )
    renderNewForm()

    await userEvent.type(
      screen.getByLabelText('Have a link? Paste it'),
      'https://www.uniqlo.com/jp/ja/products/E1'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Read link' }))

    await waitFor(() =>
      expect(screen.getByLabelText('What is it? *')).toHaveValue('Crew Neck T-Shirt')
    )
    expect(screen.getByLabelText('Details')).toHaveValue('Japanese name: クルーネックT（半袖）')
    expect(screen.getByLabelText('Expected price (yen)')).toHaveValue('1500')
  })

  it('offers to translate a name typed in Japanese', async () => {
    mockApi([])
    mocks.get.mockImplementation((path: string) =>
      path.startsWith('/translate')
        ? Promise.resolve({ text: 'ヘアマスク', is_japanese: true, translated: 'Hair mask' })
        : Promise.resolve({ items: [], steps: [] })
    )
    renderNewForm()

    const name = screen.getByLabelText('What is it? *')
    expect(screen.queryByRole('button', { name: /Translate to English/ })).not.toBeInTheDocument()

    await userEvent.type(name, 'ヘアマスク')
    await userEvent.click(await screen.findByRole('button', { name: /Translate to English/ }))

    await waitFor(() => expect(name).toHaveValue('Hair mask'))
    expect(screen.getByLabelText('Details')).toHaveValue('Japanese name: ヘアマスク')
  })

  it('does not overwrite what you already typed when reading a link', async () => {
    mockApi([])
    mocks.get.mockImplementation((path: string) =>
      path.startsWith('/product-preview')
        ? Promise.resolve({
            url: 'https://shop.example.jp/p/1',
            name: 'Shop name for it',
            image_url: null,
            shop: 'Example',
            price_yen: 900,
            price_note: null,
          })
        : Promise.resolve({ items: [], steps: [] })
    )
    renderNewForm()

    await userEvent.type(screen.getByLabelText('What is it? *'), 'My own name')
    await userEvent.type(
      screen.getByLabelText('Have a link? Paste it'),
      'https://shop.example.jp/p/1'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Read link' }))

    await waitFor(() => expect(screen.getByLabelText('Where to buy it')).toHaveValue('Example'))
    expect(screen.getByLabelText('What is it? *')).toHaveValue('My own name') // kept
  })

  it('says so when the link cannot be read', async () => {
    mockApi([])
    mocks.get.mockImplementation((path: string) =>
      path.startsWith('/product-preview')
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ items: [], steps: [] })
    )
    renderNewForm()

    await userEvent.type(screen.getByLabelText('Have a link? Paste it'), 'https://nope.example')
    await userEvent.click(screen.getByRole('button', { name: 'Read link' }))

    expect(await screen.findByText(/Could not read that link/)).toBeInTheDocument()
  })

  it('finds a photo on the web and fills the field with the one you tap', async () => {
    mockApi([])
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith('/images'))
        return Promise.resolve({
          results: [
            {
              url: 'https://upload.wikimedia.org/full.jpg',
              thumb_url: 'https://upload.wikimedia.org/thumb.jpg',
              title: 'Onitsuka Tiger',
              source: 'wikipedia',
              source_url: null,
              credit: 'Wikipedia',
            },
          ],
        })
      return Promise.resolve({ items: [] })
    })
    renderNewForm()

    // nothing is searched until asked
    expect(mocks.get).not.toHaveBeenCalledWith(expect.stringContaining('/images'))

    await userEvent.type(screen.getByLabelText('What is it? *'), 'Onitsuka Tiger')
    await userEvent.click(screen.getByRole('button', { name: /Find a photo on the web/ }))

    const thumb = await screen.findByRole('img', { name: 'Onitsuka Tiger' })
    await userEvent.click(thumb)

    expect(screen.getByLabelText('Photo URL')).toHaveValue('https://upload.wikimedia.org/full.jpg')
  })

  it('says so when the web search comes back empty', async () => {
    mockApi([])
    mocks.get.mockImplementation((path: string) =>
      path.startsWith('/images') ? Promise.resolve({ results: [] }) : Promise.resolve({ items: [] })
    )
    renderNewForm()

    await userEvent.type(screen.getByLabelText('What is it? *'), 'Very obscure thing')
    await userEvent.click(screen.getByRole('button', { name: /Find a photo on the web/ }))

    expect(await screen.findByText(/Nothing found for this one/)).toBeInTheDocument()
  })

  it('keeps the entered text and offers retry when the save fails (FR-019)', async () => {
    mockApi([])
    mocks.post.mockRejectedValue(new Error('offline'))
    renderNewForm()

    const name = screen.getByLabelText('What is it? *')
    await userEvent.type(name, 'Fino hair mask')
    await userEvent.click(screen.getByRole('button', { name: 'Add to list' }))

    expect(await screen.findByText(/Save failed — your text is safe/)).toBeInTheDocument()
    expect(name).toHaveValue('Fino hair mask')
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeInTheDocument()
  })

  it('prefills when editing', async () => {
    mockApi([item()])
    renderAt('/trips/trip-1/shopping/buy-1/edit', [
      { path: '/trips/:tripId/shopping/:itemId/edit', element: <ShoppingForm /> },
    ])

    await waitFor(() =>
      expect(screen.getByLabelText('What is it? *')).toHaveValue('Onitsuka Tiger Mexico 66')
    )
    expect(screen.getByLabelText('Expected price (yen)')).toHaveValue('12000')
    expect(screen.getByLabelText('Category')).toHaveValue('clothes')
  })
})
