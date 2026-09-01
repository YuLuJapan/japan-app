// Geocode-on-save, on the place form.
//
// The whole point of this half of the feature is what it refuses to do: a
// location reaches the save only when the traveller picked it (FR-003), and a
// place with nothing to resolve saves normally with no location at all
// (FR-004). A form that guessed would fill the map with confident wrong pins,
// which is worse than an honest missing count.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityForm from '../pages/ActivityForm'
import { renderAt } from './helpers'
import type { GeocodeResult } from '../api/types'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  geocode: vi.fn(),
}))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))
vi.mock('../api/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/hooks')>()),
  geocode: mocks.geocode,
}))

const ICHIRAN: GeocodeResult = {
  name: 'Ichiran Shibuya',
  address: '1-22-7 Jinnan, Shibuya',
  lat: 35.6614,
  lng: 139.7006,
}
const NAMESAKE: GeocodeResult = {
  name: 'Ichiran Hakata',
  address: 'Fukuoka',
  lat: 33.5904,
  lng: 130.4017,
}

const ZONE = {
  zone: { id: 'zone-tokyo', name: 'Tokyo', name_ja: null, summary: null, lat: 35.68, lng: 139.76 },
  tips: [],
  files: [],
  saved_counts: { hotel: 0, attraction: 0, food: 0, shopping: 0, other: 0 },
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.get.mockImplementation((path: string) => {
    if (path.includes('/zones/zone-tokyo')) return Promise.resolve(ZONE)
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
  mocks.geocode.mockResolvedValue({ results: [ICHIRAN, NAMESAKE] })
  mocks.post.mockResolvedValue({ activity: { id: 'pl-new' } })
})

function addPlace() {
  return renderAt('/trips/trip-1/zones/zone-tokyo/places/new', [
    { path: '/trips/:tripId/zones/:zoneId/places/new', element: <ActivityForm /> },
    { path: '/trips/:tripId/activities/:activityId', element: <p>Saved</p> },
  ])
}

/** Fill the required name and the address the lookup runs on. */
async function fill(user: ReturnType<typeof userEvent.setup>, address = '1-22-7 Jinnan') {
  await user.type(screen.getByLabelText('Name *'), 'Ichiran')
  if (address) await user.type(screen.getByLabelText('Location'), address)
}

const savedBody = () => mocks.post.mock.calls[0][1] as Record<string, unknown>

describe('a location on a new place', () => {
  it('sends the coordinates of the candidate that was accepted', async () => {
    const user = userEvent.setup()
    addPlace()
    await fill(user)
    await user.click(await screen.findByRole('button', { name: /Ichiran Shibuya/ }))
    await user.click(screen.getByRole('button', { name: 'Add place' }))

    expect(savedBody()).toMatchObject({ lat: 35.6614, lng: 139.7006 })
  })

  it('sends the other one when the other one is chosen', async () => {
    const user = userEvent.setup()
    addPlace()
    await fill(user)
    // Two real places share this name; picking is the whole interaction.
    await user.click(await screen.findByRole('button', { name: /Ichiran Hakata/ }))
    await user.click(screen.getByRole('button', { name: 'Add place' }))

    expect(savedBody()).toMatchObject({ lat: 33.5904, lng: 130.4017 })
  })

  it('shows where the accepted candidate landed', async () => {
    const user = userEvent.setup()
    addPlace()
    await fill(user)
    await user.click(await screen.findByRole('button', { name: /Ichiran Shibuya/ }))
    // Not a map, and not a raw lat/lng: the resolved address is what tells a
    // person whether the lookup found the right Ichiran.
    expect(screen.getByText(/1-22-7 Jinnan, Shibuya/)).toBeInTheDocument()
  })

  it('saves with no location when every candidate is declined', async () => {
    const user = userEvent.setup()
    addPlace()
    await fill(user)
    await screen.findByRole('button', { name: /Ichiran Shibuya/ })
    // Nothing picked — the place is still perfectly savable (FR-004).
    await user.click(screen.getByRole('button', { name: 'Add place' }))

    const body = savedBody()
    expect(body.lat ?? null).toBeNull()
    expect(body.lng ?? null).toBeNull()
  })

  it('looks nothing up for a place with no address', async () => {
    const user = userEvent.setup()
    addPlace()
    await fill(user, '')
    await user.click(screen.getByRole('button', { name: 'Add place' }))

    expect(mocks.geocode).not.toHaveBeenCalled()
    expect(savedBody()).toMatchObject({ name: 'Ichiran' })
  })

  it('leans the search on the zone it is being added to', async () => {
    const user = userEvent.setup()
    addPlace()
    await fill(user)
    await screen.findByRole('button', { name: /Ichiran Shibuya/ })
    // Tokyo's coordinates, from the zone — otherwise "Ichiran" matches a
    // namesake on the other side of the country first.
    expect(mocks.geocode).toHaveBeenCalledWith(expect.stringContaining('Jinnan'), {
      lat: 35.68,
      lng: 139.76,
    })
  })
})
