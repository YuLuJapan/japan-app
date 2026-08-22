// The invitation inbox on the trips list — an invitation that arrives without
// anyone having sent the link.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TripsList from '../pages/TripsList'
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

const invitation = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  trip_name: 'Yuval and Luciana in Japan',
  role: 'viewer',
  invited_by: 'Luciana',
  email: 'friend@example.com',
  expires_at: '2027-01-01T00:00:00.000Z',
  shows: { stays: true, flight: false, documents: false },
  ...overrides,
})

/** `/trips` and `/invitations` are the two calls this screen makes. */
function mockApi(body: Record<string, unknown>) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips') return Promise.resolve({ trips: [] })
    if (path === '/invitations') return Promise.resolve(body)
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

const routes = [{ path: '/trips', element: <TripsList /> }]

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  localStorage.clear()
})

describe('the invitation inbox', () => {
  it('names who invited you, to what, and what you would see', async () => {
    mockApi({ invitations: [invitation()] })
    renderAt('/trips', routes)

    expect(
      await screen.findByText('Luciana invited you to Yuval and Luciana in Japan')
    ).toBeInTheDocument()
    // The flags in the invitation, said in the trip's own words.
    expect(screen.getByText(/You’ll also see where they’re staying\./)).toBeInTheDocument()
    expect(screen.getByText(/look, not change/)).toBeInTheDocument()
  })

  it('says so plainly when a viewer would see none of the bookings', async () => {
    mockApi({
      invitations: [invitation({ shows: { stays: false, flight: false, documents: false } })],
    })
    renderAt('/trips', routes)

    expect(await screen.findByText(/The bookings and documents stay private\./)).toBeInTheDocument()
  })

  it('accepts, and refreshes the trips list rather than navigating', async () => {
    mockApi({ invitations: [invitation()] })
    mocks.post.mockResolvedValue({ trip_id: 'trip-1', role: 'viewer', already_member: false })
    renderAt('/trips', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    expect(mocks.post).toHaveBeenCalledWith('/invitations/inv-1/accept', {})
  })

  it('declines without joining anything', async () => {
    mockApi({ invitations: [invitation()] })
    mocks.post.mockResolvedValue(undefined)
    renderAt('/trips', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'No thanks' }))

    expect(mocks.post).toHaveBeenCalledWith('/invitations/inv-1/decline', {})
  })

  it('renders nothing at all when nothing is waiting', async () => {
    mockApi({ invitations: [] })
    renderAt('/trips', routes)

    expect(await screen.findByText('Your trips')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })

  it('points an unconfirmed address at its inbox instead of showing nothing', async () => {
    mockApi({ invitations: [], email_unconfirmed: true })
    renderAt('/trips', routes)

    expect(await screen.findByText('Confirm your email address')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })
})
