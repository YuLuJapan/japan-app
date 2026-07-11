import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import PlaceDetail from '../pages/PlaceDetail'
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

describe('Zone page (US1)', () => {
  it('shows only categories that have places, without breaking navigation (FR-012)', async () => {
    mocks.get.mockResolvedValue({
      zone: { id: 'zone-1', name: 'Tokyo', name_ja: '東京', summary: 'Big city' },
      tips: [{ id: 't1', body: 'Get a Suica card' }],
      files: [],
      place_counts: { hotel: 0, attraction: 2, food: 1, shopping: 0, other: 0 },
    })
    renderAt('/zones/zone-1', [{ path: '/zones/:zoneId', element: <Zone /> }])

    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    expect(screen.getByTestId('category-attraction')).toBeInTheDocument()
    expect(screen.getByTestId('category-food')).toBeInTheDocument()
    expect(screen.queryByTestId('category-hotel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('category-shopping')).not.toBeInTheDocument()
    // zone-level tips visible (FR-004)
    expect(screen.getByText('Get a Suica card')).toBeInTheDocument()
  })
})

describe('PlaceDetail page (US1)', () => {
  it('shows tips alongside the place details (US1 AC3)', async () => {
    mocks.get.mockResolvedValue({
      place: {
        id: 'p1',
        zone_id: 'zone-1',
        category: 'attraction',
        name: 'Fushimi Inari',
        name_ja: '伏見稲荷大社',
        description: 'The thousand torii gates.',
        address: 'Fushimi-ku, Kyoto',
        links: [{ label: 'Official site', url: 'https://example.com' }],
      },
      tips: [{ id: 't1', body: 'Sunrise visit — no crowds' }],
      files: [],
    })
    renderAt('/places/p1', [{ path: '/places/:placeId', element: <PlaceDetail /> }])

    expect(await screen.findByText('Fushimi Inari')).toBeInTheDocument()
    expect(screen.getByText('The thousand torii gates.')).toBeInTheDocument()
    expect(screen.getByText('Sunrise visit — no crowds')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Official site/ })).toHaveAttribute(
      'href',
      'https://example.com'
    )
  })
})
