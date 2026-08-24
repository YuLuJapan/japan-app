import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { withTableMissing } from '../../server/testing/db'
import ShoppingCategoryPage from '../pages/ShoppingCategory'
import ShoppingForm from '../pages/ShoppingForm'
import ShoppingItemDetail from '../pages/ShoppingItem'
import ShoppingList from '../pages/ShoppingList'
import { insert, patchRow, remove, rows } from './data'
import { outside } from './outside'
import { renderAt } from './helpers'

// The list is real rows, the money is converted at the rate the API quoted,
// and the product link and photo search really go out over HTTP — to the local
// stand-in for the web, which each case steers (src/tests/outside.ts).

interface ItemRow {
  id: string
  name: string
  bought: boolean
  image_url: string | null
  price_yen: number | null
  shop: string | null
}

/** The fixture's own two items, by the names they carry. */
const SHOES = 'Onitsuka Tiger Mexico 66'
const SHAMPOO = 'Ichikami shampoo'

const savedItem = async (name: string) => (await rows<ItemRow>('shopping_items', 'name', name))[0]

beforeEach(async () => {
  // The fixture marks the shampoo bought; most of these cases want a list
  // where nothing is, and say so when they don't.
  await patchRow('shopping_items', 'shop-shampoo', { bought: false })
})

const shoppingListRoute = { path: '/trips/:tripId/shopping', element: <ShoppingList /> }
const renderShoppingList = () => renderAt('/trips/trip-1/shopping', [shoppingListRoute])

describe('Shopping home (category carousels)', () => {
  it('groups items into one section per category, each linking to its own page', async () => {
    renderShoppingList()

    const clothes = (await screen.findByRole('heading', { name: /Clothes & shoes/ })).closest(
      'section'
    )!
    const hair = screen.getByRole('heading', { name: /Hair care/ }).closest('section')!

    // each item sits under its own category, not in one flat list
    expect(within(clothes).getByText(SHOES)).toBeInTheDocument()
    expect(within(clothes).queryByText(SHAMPOO)).not.toBeInTheDocument()
    expect(within(hair).getByText(SHAMPOO)).toBeInTheDocument()

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
    renderShoppingList()

    expect(await screen.findByRole('link', { name: /Onitsuka Tiger/ })).toHaveAttribute(
      'href',
      '/trips/trip-1/shopping/shop-shoes'
    )
  })

  it('shows progress and what is left to spend', async () => {
    await remove('shopping_items', 'id', 'shop-shampoo')
    await insert('shopping_items', [
      { id: 'shop-kitkat', trip_id: 'trip-1', name: 'Kit Kats', price_yen: 600, bought: true },
    ])
    renderShoppingList()

    expect(await screen.findByText('1 of 2 bought')).toBeInTheDocument()
    expect(screen.getByText('¥12,600')).toBeInTheDocument() // total value of everything on the list
    // ¥12,000 still to buy, at the 0.025 ILS the provider quoted.
    expect(screen.getByText(/₪300.*still to spend/)).toBeInTheDocument()
  })

  it('ticks an item off straight from the carousel', async () => {
    renderShoppingList()

    await userEvent.click(await screen.findByRole('button', { name: `Mark ${SHOES} as bought` }))

    await waitFor(async () => expect((await savedItem(SHOES)).bought).toBe(true))
  })

  it('renders an empty state with nothing on the list', async () => {
    await remove('shopping_items', 'trip_id', 'trip-1')
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
    await insert('shopping_items', [
      {
        id: 'shop-heattech',
        trip_id: 'trip-1',
        name: 'Uniqlo HEATTECH',
        category: 'clothes',
        price_yen: 1500,
        bought: true,
      },
    ])
    renderCategory('clothes')

    expect(await screen.findByRole('heading', { name: /Clothes & shoes/ })).toBeInTheDocument()
    expect(screen.getByText(SHOES)).toBeInTheDocument()
    expect(screen.getByText('Uniqlo HEATTECH')).toBeInTheDocument()
    expect(screen.queryByText(SHAMPOO)).not.toBeInTheDocument() // other category

    expect(screen.getByText('To buy · 1')).toBeInTheDocument()
    expect(screen.getByText('Bought · 1')).toBeInTheDocument()
    expect(screen.getByText(/1\/2 bought/)).toBeInTheDocument()
  })

  it('ticks an item off when the row is swiped right', async () => {
    renderCategory('clothes')

    swipe(await rowFor(SHOES), 120)

    await waitFor(async () => expect((await savedItem(SHOES)).bought).toBe(true))
  })

  it('asks before deleting when the row is swiped left', async () => {
    renderCategory('clothes')

    swipe(await rowFor(SHOES), -120)

    // the swipe alone must not delete anything
    expect(await rows<ItemRow>('shopping_items', 'id', 'shop-shoes')).toHaveLength(1)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(new RegExp(`Delete ${SHOES}`))

    await userEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Delete')!
    )
    await waitFor(async () =>
      expect(await rows<ItemRow>('shopping_items', 'id', 'shop-shoes')).toHaveLength(0)
    )
  })

  it('ignores a short sideways nudge and a vertical scroll', async () => {
    renderCategory('clothes')
    const row = await rowFor(SHOES)

    swipe(row, 40) // too short to count
    swipe(row, 0, 150) // scrolling down the page

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const [item] = await rows<ItemRow>('shopping_items', 'id', 'shop-shoes')
    expect(item.bought).toBe(false)
  })

  it('adds into the category you are looking at', async () => {
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

/** A Wikipedia image-search answer with one usable photo in it. */
const photoNamed = (title: string, file: string) => ({
  query: {
    pages: {
      '1': {
        title,
        thumbnail: { source: `https://upload.wikimedia.org/${file}-thumb.jpg` },
        original: { source: `https://upload.wikimedia.org/${file}.jpg` },
      },
    },
  },
})

describe('Shopping item detail', () => {
  it('shows the price, where to buy it and the notes', async () => {
    renderItemDetail('shop-shoes')

    expect(await screen.findByRole('heading', { name: SHOES })).toBeInTheDocument()
    expect(screen.getByText('¥12,000')).toBeInTheDocument()
    // Converted at the rates the API quoted: 0.025 ILS and 0.0067 USD to the yen.
    expect(screen.getByText(/≈ ₪300.00 ≈ \$80.40/)).toBeInTheDocument()
    expect(screen.getByText(/Onitsuka Tiger Ginza/)).toBeInTheDocument()
    // The city comes from the trip bundle, which is a second request — hence
    // the await rather than a synchronous get.
    expect(await screen.findByText(/Tokyo/)).toBeInTheDocument()
    expect(screen.getByText('Size 42')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/trips/trip-1/shopping/shop-shoes/edit'
    )
  })

  it('marks the item bought from the detail page', async () => {
    renderItemDetail('shop-shoes')

    await userEvent.click(await screen.findByRole('button', { name: 'Mark as bought' }))

    await waitFor(async () => expect((await savedItem(SHOES)).bought).toBe(true))
  })

  it('offers to put a bought item back on the list', async () => {
    await patchRow('shopping_items', 'shop-shoes', { bought: true })
    renderItemDetail('shop-shoes')

    expect(await screen.findByRole('button', { name: 'Put back on the list' })).toBeInTheDocument()
    expect(screen.getByText('✓ Already bought')).toBeInTheDocument()
  })

  it('asks for confirmation before deleting', async () => {
    renderItemDetail('shop-shoes', [{ path: '/trips/:tripId/shopping', element: <p>list</p> }])

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await rows<ItemRow>('shopping_items', 'id', 'shop-shoes')).toHaveLength(1) // dialog first

    const dialog = screen.getByRole('dialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete'
    )!
    await userEvent.click(confirm)
    await waitFor(async () =>
      expect(await rows<ItemRow>('shopping_items', 'id', 'shop-shoes')).toHaveLength(0)
    )
  })

  it('offers a web photo search for an item that has none, and saves the pick', async () => {
    await patchRow('shopping_items', 'shop-shoes', { name: 'Kit Kat', image_url: null })
    await outside.wikipedia(photoNamed('Kit Kat', 'found'))
    renderItemDetail('shop-shoes')

    await userEvent.click(await screen.findByRole('button', { name: /Find a photo on the web/ }))
    await userEvent.click(await screen.findByRole('img', { name: 'Kit Kat' }))

    await waitFor(async () =>
      expect((await savedItem('Kit Kat')).image_url).toBe('https://upload.wikimedia.org/found.jpg')
    )
  })

  it('explains itself when the item is gone', async () => {
    renderItemDetail('buy-gone')

    expect(await screen.findByText(/no longer on the list/)).toBeInTheDocument()
  })
})

const newFormRoute = { path: '/trips/:tripId/shopping/new', element: <ShoppingForm /> }
const renderNewForm = (query = '', extraRoutes: { path: string; element: JSX.Element }[] = []) =>
  renderAt(`/trips/trip-1/shopping/new${query}`, [newFormRoute, ...extraRoutes])

/** A shop's product page, as Open Graph tags. */
const productPage = (over: { title: string; shop: string; price: number; image?: string }) => `
<!doctype html><html><head>
<meta property="og:title" content="${over.title}">
<meta property="og:site_name" content="${over.shop}">
${over.image ? `<meta property="og:image" content="${over.image}">` : ''}
<meta property="product:price:amount" content="${over.price}">
<meta property="product:price:currency" content="JPY">
</head><body></body></html>`

describe('ShoppingForm', () => {
  it('creates an item with shop, price and photo, then opens its page', async () => {
    renderNewForm('', [{ path: '/trips/:tripId/shopping/:itemId', element: <p>detail page</p> }])

    await userEvent.type(screen.getByLabelText('What is it? *'), 'Uniqlo HEATTECH')
    await userEvent.type(screen.getByLabelText('Where to buy it'), 'Uniqlo Ginza')
    await userEvent.type(screen.getByLabelText('Expected price (yen)'), '1500')
    await userEvent.type(screen.getByLabelText('Photo URL'), 'https://example.com/heattech.jpg')
    await userEvent.click(screen.getByRole('button', { name: 'Add to list' }))

    await waitFor(async () => {
      expect(await savedItem('Uniqlo HEATTECH')).toMatchObject({
        shop: 'Uniqlo Ginza',
        price_yen: 1500,
        image_url: 'https://example.com/heattech.jpg',
        bought: false,
      })
    })
    expect(await screen.findByText('detail page')).toBeInTheDocument()
  })

  it('starts in the category you added from', async () => {
    renderNewForm('?category=skincare')

    expect(screen.getByLabelText('Category')).toHaveValue('skincare')
  })

  it('fills the form from a pasted product link', async () => {
    const url = await outside.page(
      '/jp/en/products/E123',
      productPage({
        title: 'HEATTECH Crew Neck T-Shirt',
        shop: 'UNIQLO',
        price: 1500,
        image: '/img/heattech.jpg',
      })
    )
    renderNewForm()

    await userEvent.type(screen.getByLabelText('Have a link? Paste it'), url)
    await userEvent.click(screen.getByRole('button', { name: 'Read link' }))

    await waitFor(() =>
      expect(screen.getByLabelText('What is it? *')).toHaveValue('HEATTECH Crew Neck T-Shirt')
    )
    expect(screen.getByLabelText('Where to buy it')).toHaveValue('UNIQLO')
    expect(screen.getByLabelText('Expected price (yen)')).toHaveValue('1500')
    // The relative og:image, resolved against the page it came from.
    expect(screen.getByLabelText('Photo URL')).toHaveValue(outside.urlFor('/img/heattech.jpg'))
    expect(screen.getByLabelText('Product link')).toHaveValue(url)
  })

  it('shows the English name from a Japanese page and keeps the Japanese in the details', async () => {
    // A /jp/ja/ page with a Japanese title, and the shop's own English page at
    // the matching /jp/en/ path — which the API prefers over translating.
    const url = await outside.page(
      '/jp/ja/products/E1',
      productPage({ title: 'クルーネックT（半袖）', shop: 'ユニクロ公式', price: 1500 })
    )
    await outside.page(
      '/jp/en/products/E1',
      productPage({ title: 'Crew Neck T-Shirt', shop: 'UNIQLO', price: 1500 })
    )
    renderNewForm()

    await userEvent.type(screen.getByLabelText('Have a link? Paste it'), url)
    await userEvent.click(screen.getByRole('button', { name: 'Read link' }))

    await waitFor(() =>
      expect(screen.getByLabelText('What is it? *')).toHaveValue('Crew Neck T-Shirt')
    )
    expect(screen.getByLabelText('Details')).toHaveValue('Japanese name: クルーネックT（半袖）')
    expect(screen.getByLabelText('Expected price (yen)')).toHaveValue('1500')
  })

  it('offers to translate a name typed in Japanese', async () => {
    await outside.translation('Hair mask')
    renderNewForm()

    const name = screen.getByLabelText('What is it? *')
    expect(screen.queryByRole('button', { name: /Translate to English/ })).not.toBeInTheDocument()

    await userEvent.type(name, 'ヘアマスク')
    await userEvent.click(await screen.findByRole('button', { name: /Translate to English/ }))

    await waitFor(() => expect(name).toHaveValue('Hair mask'))
    expect(screen.getByLabelText('Details')).toHaveValue('Japanese name: ヘアマスク')
  })

  it('does not overwrite what you already typed when reading a link', async () => {
    const url = await outside.page(
      '/p/1',
      productPage({ title: 'Shop name for it', shop: 'Example', price: 900 })
    )
    renderNewForm()

    await userEvent.type(screen.getByLabelText('What is it? *'), 'My own name')
    await userEvent.type(screen.getByLabelText('Have a link? Paste it'), url)
    await userEvent.click(screen.getByRole('button', { name: 'Read link' }))

    await waitFor(() => expect(screen.getByLabelText('Where to buy it')).toHaveValue('Example'))
    expect(screen.getByLabelText('What is it? *')).toHaveValue('My own name') // kept
  })

  it('says so when the page cannot be read, and keeps the link', async () => {
    // A shop whose server drops the connection. The API answers — it just has
    // nothing to report — so the form says the page was unreadable and keeps
    // the link.
    const url = await outside.deadPage('/p/dead')
    renderNewForm()

    await userEvent.type(screen.getByLabelText('Have a link? Paste it'), url)
    await userEvent.click(screen.getByRole('button', { name: 'Read link' }))

    expect(await screen.findByText(/Could not read that page/)).toBeInTheDocument()
    expect(screen.getByLabelText('Product link')).toHaveValue(url)
  })

  it('says so when the link itself is refused', async () => {
    renderNewForm()

    // The API will not fetch its own network, so this is a 400 rather than an
    // empty answer — a different message, because it is a different problem.
    await userEvent.type(screen.getByLabelText('Have a link? Paste it'), 'http://127.0.0.1/admin')
    await userEvent.click(screen.getByRole('button', { name: 'Read link' }))

    expect(await screen.findByText(/Could not read that link/)).toBeInTheDocument()
  })

  it('finds a photo on the web and fills the field with the one you tap', async () => {
    await outside.wikipedia(photoNamed('Onitsuka Tiger', 'full'))
    renderNewForm()

    // nothing is searched until asked
    expect(screen.queryByRole('img', { name: 'Onitsuka Tiger' })).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('What is it? *'), 'Onitsuka Tiger')
    await userEvent.click(screen.getByRole('button', { name: /Find a photo on the web/ }))

    const thumb = await screen.findByRole('img', { name: 'Onitsuka Tiger' })
    await userEvent.click(thumb)

    expect(screen.getByLabelText('Photo URL')).toHaveValue('https://upload.wikimedia.org/full.jpg')
  })

  it('says so when the web search comes back empty', async () => {
    await outside.noPhotos()
    renderNewForm()

    await userEvent.type(screen.getByLabelText('What is it? *'), 'Very obscure thing')
    await userEvent.click(screen.getByRole('button', { name: /Find a photo on the web/ }))

    expect(await screen.findByText(/Nothing found for this one/)).toBeInTheDocument()
  })

  it('keeps the entered text and offers retry when the save fails (FR-019)', async () => {
    renderNewForm()

    const name = screen.getByLabelText('What is it? *')
    await userEvent.type(name, 'Fino hair mask')

    // A save that really cannot land.
    await withTableMissing('shopping_items', async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Add to list' }))
      expect(await screen.findByText(/Save failed — your text is safe/)).toBeInTheDocument()
      expect(name).toHaveValue('Fino hair mask')
      expect(screen.getByRole('button', { name: 'Retry save' })).toBeInTheDocument()
    })
  })

  it('prefills when editing', async () => {
    renderAt('/trips/trip-1/shopping/shop-shoes/edit', [
      { path: '/trips/:tripId/shopping/:itemId/edit', element: <ShoppingForm /> },
    ])

    await waitFor(() => expect(screen.getByLabelText('What is it? *')).toHaveValue(SHOES))
    expect(screen.getByLabelText('Expected price (yen)')).toHaveValue('12000')
    expect(screen.getByLabelText('Category')).toHaveValue('clothes')
  })
})
