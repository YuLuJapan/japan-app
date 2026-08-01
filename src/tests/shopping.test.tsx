import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ShoppingForm from '../pages/ShoppingForm'
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

/** One fetch mock for every query the shopping pages make. */
function mockApi(items: ShoppingItem[]) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/shopping') return Promise.resolve({ items })
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

describe('ShoppingList', () => {
  it('shows what to buy, where, and the price in yen with a shekel estimate', async () => {
    mockApi([item()])
    renderAt('/shopping', [{ path: '/shopping', element: <ShoppingList /> }])

    expect(await screen.findByText('Onitsuka Tiger Mexico 66')).toBeInTheDocument()
    expect(screen.getByText('Size 42')).toBeInTheDocument()
    expect(await screen.findByText(/ABC Mart · Tokyo/)).toBeInTheDocument()
    // once on the card, once in the "still to spend" header total
    expect(await screen.findAllByText(/¥12,000 ≈ ₪300/)).toHaveLength(2)
  })

  it('marks an item as bought', async () => {
    mockApi([item()])
    mocks.patch.mockResolvedValue({ item: item({ bought: true }) })
    renderAt('/shopping', [{ path: '/shopping', element: <ShoppingList /> }])

    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark Onitsuka Tiger Mexico 66 as bought' })
    )
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/shopping/buy-1', { bought: true })
    )
  })

  it('separates bought items and counts progress', async () => {
    mockApi([item(), item({ id: 'buy-2', name: 'Ichikami shampoo', bought: true, price_yen: 900 })])
    renderAt('/shopping', [{ path: '/shopping', element: <ShoppingList /> }])

    expect(await screen.findByText(/1\/2 bought/)).toBeInTheDocument()
    expect(screen.getByText('To buy · 1')).toBeInTheDocument()
    expect(screen.getByText('Bought · 1')).toBeInTheDocument()
  })

  it('renders an empty state with nothing on the list', async () => {
    mockApi([])
    renderAt('/shopping', [{ path: '/shopping', element: <ShoppingList /> }])

    expect(await screen.findByText(/Nothing on the list yet/)).toBeInTheDocument()
  })
})

describe('ShoppingForm', () => {
  it('creates an item with shop, price and photo', async () => {
    mockApi([])
    mocks.post.mockResolvedValue({ item: item() })
    renderAt('/shopping/new', [
      { path: '/shopping/new', element: <ShoppingForm /> },
      { path: '/shopping', element: <p>list</p> },
    ])

    await userEvent.type(screen.getByLabelText('What is it? *'), 'Uniqlo HEATTECH')
    await userEvent.type(screen.getByLabelText('Where to buy it'), 'Uniqlo Ginza')
    await userEvent.type(screen.getByLabelText('Expected price (yen)'), '1500')
    await userEvent.type(screen.getByLabelText('Photo URL'), 'https://example.com/heattech.jpg')
    await userEvent.click(screen.getByRole('button', { name: 'Add to list' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/shopping',
        expect.objectContaining({
          name: 'Uniqlo HEATTECH',
          shop: 'Uniqlo Ginza',
          price_yen: 1500,
          image_url: 'https://example.com/heattech.jpg',
          bought: false,
        })
      )
    )
  })

  it('keeps the entered text and offers retry when the save fails (FR-019)', async () => {
    mockApi([])
    mocks.post.mockRejectedValue(new Error('offline'))
    renderAt('/shopping/new', [{ path: '/shopping/new', element: <ShoppingForm /> }])

    const name = screen.getByLabelText('What is it? *')
    await userEvent.type(name, 'Fino hair mask')
    await userEvent.click(screen.getByRole('button', { name: 'Add to list' }))

    expect(await screen.findByText(/Save failed — your text is safe/)).toBeInTheDocument()
    expect(name).toHaveValue('Fino hair mask')
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeInTheDocument()
  })

  it('prefills when editing and asks before deleting', async () => {
    mockApi([item()])
    mocks.delete.mockResolvedValue(undefined)
    renderAt('/shopping/buy-1/edit', [
      { path: '/shopping/:itemId/edit', element: <ShoppingForm /> },
      { path: '/shopping', element: <p>list</p> },
    ])

    await waitFor(() =>
      expect(screen.getByLabelText('What is it? *')).toHaveValue('Onitsuka Tiger Mexico 66')
    )
    expect(screen.getByLabelText('Expected price (yen)')).toHaveValue('12000')

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.delete).not.toHaveBeenCalled() // confirmation first

    const dialog = screen.getByRole('dialog')
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete'
    )!
    await userEvent.click(confirm)
    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/shopping/buy-1'))
  })
})
