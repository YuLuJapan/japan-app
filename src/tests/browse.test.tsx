import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import ActivityDetail from '../pages/ActivityDetail'
import CategoryList from '../pages/CategoryList'
import Zone from '../pages/Zone'
import { activity, renderAt } from './helpers'

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

// Explore's grid: one row per tag, counted off the activities list. Two
// attractions in Tokyo — one on a day, one not — plus a scheduled food stop, so
// the split label has something to say and the dated half is not invisible.
const zonePayloads = () => {
  const zone = {
    zone: { id: 'zone-1', name: 'Tokyo', name_ja: '東京', summary: 'Big city' },
    tips: [{ id: 't1', body: 'Get a Suica card' }],
    files: [],
  }
  const activities = {
    activities: [
      activity({ id: 'a1', name: 'Senso-ji', zone_id: 'zone-1', category: 'attraction' }),
      activity({
        id: 'a2',
        name: 'Shibuya Sky',
        zone_id: 'zone-1',
        category: 'attraction',
        day: '2026-09-20',
      }),
      activity({
        id: 'a3',
        name: 'Afuri',
        zone_id: 'zone-1',
        category: 'food',
        day: '2026-09-20',
      }),
      // another city's row must not reach this grid
      activity({ id: 'a4', name: 'Kinkaku-ji', zone_id: 'zone-2', category: 'attraction' }),
    ],
  }
  return (url: string) =>
    Promise.resolve(url.includes('/activities') ? activities : url.includes('/zones/') ? zone : {})
}

describe('Zone page (US1)', () => {
  it('groups every tag, dated and undated together, and counts them apart', async () => {
    mocks.get.mockImplementation(zonePayloads())
    renderAt('/trips/trip-1/zones/zone-1', [
      { path: '/trips/:tripId/zones/:zoneId', element: <Zone /> },
    ])

    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    // one saved + one planned attraction, in this city only — the Kyoto row
    // carries the same tag and must not be counted here
    expect(await screen.findByText('1 planned · 1 saved')).toBeInTheDocument()
    // the food stop has a date and is still listed under its tag: that is the
    // change — before, Explore showed the undated half only
    expect(screen.getByText('1 planned')).toBeInTheDocument()
    // zone-level tips visible (FR-004)
    expect(screen.getByText('Get a Suica card')).toBeInTheDocument()
  })

  it('offers every tag to someone who can add, empty ones included', async () => {
    mocks.get.mockImplementation(zonePayloads())
    renderAt('/trips/trip-1/zones/zone-1', [
      { path: '/trips/:tripId/zones/:zoneId', element: <Zone /> },
    ])

    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    // An empty tag is where a new activity goes, so hiding it hides the way in.
    expect(screen.getByTestId('category-hotel')).toBeInTheDocument()
    expect(screen.getByTestId('category-shopping')).toBeInTheDocument()
    expect(screen.getAllByText('Nothing yet')).toHaveLength(3) // stays, shopping, more
  })

  it('shows a read-only member only the tags that hold something', async () => {
    mocks.get.mockImplementation(zonePayloads())
    renderAt(
      '/trips/trip-1/zones/zone-1',
      [{ path: '/trips/:tripId/zones/:zoneId', element: <Zone /> }],
      { tripRole: 'viewer' }
    )

    expect(await screen.findByText('Tokyo')).toBeInTheDocument()
    expect(screen.getByTestId('category-attraction')).toBeInTheDocument()
    expect(screen.getByTestId('category-food')).toBeInTheDocument()
    // they cannot add, so an empty row would be a button that leads nowhere
    expect(screen.queryByTestId('category-hotel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('category-shopping')).not.toBeInTheDocument()
  })
})

describe('Explore’s category list', () => {
  it('lists this city’s tag whether or not the activity has a date', async () => {
    mocks.get.mockImplementation(zonePayloads())
    renderAt('/trips/trip-1/zones/zone-1/c/attraction', [
      { path: '/trips/:tripId/zones/:zoneId/c/:category', element: <CategoryList /> },
    ])

    // the undated one, which is all Explore used to show …
    expect(await screen.findByText('Senso-ji')).toBeInTheDocument()
    // … and the dated one, which used to live only on the Schedule
    expect(screen.getByText('Shibuya Sky')).toBeInTheDocument()
    // carrying the day it is on, so the two halves are told apart at a glance
    expect(screen.getByText('Sep 20')).toBeInTheDocument()

    // another city's row with the same tag stays in its own city
    expect(screen.queryByText('Kinkaku-ji')).not.toBeInTheDocument()
    // and another tag stays in its own list
    expect(screen.queryByText('Afuri')).not.toBeInTheDocument()
  })

  it('invites the first one when a tag is empty', async () => {
    mocks.get.mockImplementation(zonePayloads())
    renderAt('/trips/trip-1/zones/zone-1/c/shopping', [
      { path: '/trips/:tripId/zones/:zoneId/c/:category', element: <CategoryList /> },
    ])

    expect(await screen.findByText(/Nothing under shopping here yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+ Add' })).toBeInTheDocument()
  })
})

describe('ActivityDetail page (US1)', () => {
  it('shows tips alongside the place details (US1 AC3)', async () => {
    mocks.get.mockResolvedValue({
      activity: {
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
    renderAt('/trips/trip-1/activities/p1', [
      { path: '/trips/:tripId/activities/:activityId', element: <ActivityDetail /> },
    ])

    expect(await screen.findByText('Fushimi Inari')).toBeInTheDocument()
    expect(screen.getByText('The thousand torii gates.')).toBeInTheDocument()
    expect(screen.getByText('Sunrise visit — no crowds')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Official site/ })).toHaveAttribute(
      'href',
      'https://example.com'
    )
  })
})
