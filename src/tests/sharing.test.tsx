// The two sharing screens: the roster (which adapts to your role) and the
// link you land on when someone shares a trip with you.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { ApiError } from '../api/client'
import userEvent from '@testing-library/user-event'
import AcceptInvite from '../pages/AcceptInvite'
import TripMembers from '../pages/TripMembers'
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

const MEMBERS = {
  members: [
    {
      user_id: 'u-owner',
      role: 'owner',
      email: 'yuval@example.com',
      display_name: 'Yuval',
      avatar_url: null,
      can_see_stays: true,
      can_see_flight: true,
      can_see_documents: true,
    },
    {
      user_id: 'u-friend',
      role: 'viewer',
      email: 'friend@example.com',
      display_name: 'Friend',
      avatar_url: null,
      can_see_stays: true,
      can_see_flight: false,
      can_see_documents: false,
    },
  ],
}

function mockApi(myRole: string) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1') return Promise.resolve({ trip: {}, steps: [], my_role: myRole })
    if (path === '/trips/trip-1/members') return Promise.resolve(MEMBERS)
    if (path === '/trips/trip-1/invites') return Promise.resolve({ invites: [] })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

const membersRoutes = [{ path: '/trips/:tripId/members', element: <TripMembers /> }]

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset())
  localStorage.clear()
  sessionStorage.clear()
})

describe('the roster adapts to your role', () => {
  it('lets an owner change a role and a viewer’s visibility', async () => {
    mockApi('owner')
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByText('Friend')).toBeInTheDocument()
    expect(screen.getByLabelText('Access for Friend')).toBeInTheDocument()
    // Two sets of the three toggles: the viewer's own row, and the invite form.
    // The owner is not offered any — writers ignore the flags entirely.
    expect(screen.getAllByText('Where we’re staying')).toHaveLength(2)
    expect(screen.queryByLabelText('Access for Yuval')).toBeInTheDocument()
  })

  it('saves a member’s access on a button, not on every click', async () => {
    mockApi('owner')
    mocks.patch.mockResolvedValue({ member: {} })
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByText('Friend')).toBeInTheDocument()
    // Nothing to save until something is changed.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()

    // The viewer's own row is the first of the two 'Flights' toggles; the
    // second belongs to the invite form below it.
    await userEvent.click(screen.getAllByLabelText(/Flights/)[0])
    expect(mocks.patch).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    // Role and all three flags travel together in one patch.
    expect(mocks.patch).toHaveBeenCalledWith('/trips/trip-1/members/u-friend', {
      role: 'viewer',
      can_see_stays: true,
      can_see_flight: true,
      can_see_documents: false,
    })
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('keeps the edit and says why when the server refuses it', async () => {
    mockApi('owner')
    mocks.patch.mockRejectedValue(
      new ApiError(400, 'VALIDATION', 'Invalid', ['This trip would be left with no owner.'])
    )
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByText('Yuval')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Access for Yuval'), 'viewer')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/left with no owner/)).toBeInTheDocument()
    // The refusal does not silently snap the control back — the choice is
    // still there to correct or discard.
    expect(screen.getByLabelText('Access for Yuval')).toHaveValue('viewer')
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('says why an owner has nothing to tick, rather than showing a gap', async () => {
    mockApi('owner')
    renderAt('/trips/trip-1/members', membersRoutes)

    // Yuval is an owner: no toggles, and the reason spelled out where they
    // would have been. Friend is a viewer, so the three toggles are there.
    expect(await screen.findByText(/Owners can edit this trip/)).toBeInTheDocument()
    expect(screen.getAllByText('Where we’re staying')).toHaveLength(2)

    // Demoting them offers the toggles straight away, before the save — the
    // role and what they see are one decision.
    await userEvent.selectOptions(screen.getByLabelText('Access for Yuval'), 'viewer')
    expect(screen.getAllByText('Where we’re staying')).toHaveLength(3)
  })

  it('says the invite settings are not about anyone already here', async () => {
    mockApi('owner')
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(
      await screen.findByText(/does not change anyone already on the trip/)
    ).toBeInTheDocument()
  })

  it('offers a way back to Essentials, the only screen that leads here', async () => {
    mockApi('viewer')
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByRole('link', { name: 'Essentials' })).toHaveAttribute(
      'href',
      '/trips/trip-1/essentials'
    )
  })

  it('shows a partner the roster read-only, with a viewer-only invite', async () => {
    mockApi('partner')
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByText('Friend')).toBeInTheDocument()
    // No role dropdowns, no remove.
    expect(screen.queryByLabelText('Access for Friend')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    // …but they can still bring in a viewer, and only a viewer: the Partner
    // option is not offered at all.
    expect(screen.getByRole('button', { name: /Create invite link/ })).toBeInTheDocument()
    expect(screen.getByText('Can look, not change.')).toBeInTheDocument()
    expect(screen.queryByText('Can edit everything. Can invite viewers.')).not.toBeInTheDocument()
  })

  it('shows a viewer the roster and no way to change it', async () => {
    mockApi('viewer')
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByText('Friend')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create invite link/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Access for Friend')).not.toBeInTheDocument()
  })

  it('surfaces the minted link once, with the copy-it-now warning', async () => {
    mockApi('owner')
    mocks.post.mockResolvedValue({ invite: { id: 'inv-1' }, token: 'tok-abc' })
    renderAt('/trips/trip-1/members', membersRoutes)

    await userEvent.click(await screen.findByRole('button', { name: /Create invite link/ }))

    expect(await screen.findByText(/only shown once/)).toBeInTheDocument()
    expect(screen.getByText(/\/invite\/tok-abc/)).toBeInTheDocument()
    expect(mocks.post).toHaveBeenCalledWith('/trips/trip-1/invites', {
      role: 'viewer',
      can_see_stays: true,
      can_see_flight: true,
      can_see_documents: false,
    })
  })
})

const inviteRoutes = [
  { path: '/invite/:token', element: <AcceptInvite /> },
  { path: '/gate', element: <p>sign in page</p> },
  { path: '/trips/:tripId', element: <p>the trip</p> },
]

describe('opening an invite link', () => {
  it('sends a signed-out visitor to sign in, remembering the link', async () => {
    renderAt('/invite/tok-abc', inviteRoutes)

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('sign in page')).toBeInTheDocument()
    expect(sessionStorage.getItem('pending_invite')).toBe('tok-abc')
  })

  it('says what the link grants, then joins', async () => {
    localStorage.setItem('trip_access_code', 'a.jwt')
    mocks.get.mockResolvedValue({
      invite: {
        trip_name: 'Japan',
        role: 'viewer',
        invited_by: 'Yuval',
        email: null,
        expires_at: '2026-09-01T00:00:00Z',
        shows: { stays: true, flight: false, documents: false },
      },
    })
    mocks.post.mockResolvedValue({ trip_id: 'trip-1', role: 'viewer', already_member: false })
    renderAt('/invite/tok-abc', inviteRoutes)

    expect(await screen.findByText('Japan')).toBeInTheDocument()
    expect(screen.getByText(/Yuval invited you to/)).toBeInTheDocument()
    // Only the things the invite actually turns on are listed.
    expect(screen.getByText(/where you’re staying/)).toBeInTheDocument()
    expect(screen.queryByText(/the flights/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Join this trip' }))
    expect(await screen.findByText('the trip')).toBeInTheDocument()
    expect(mocks.post).toHaveBeenCalledWith('/invites/tok-abc/accept', {})
  })

  it('explains a dead link instead of failing silently', async () => {
    localStorage.setItem('trip_access_code', 'a.jwt')
    mocks.get.mockRejectedValue(new Error('not found'))
    renderAt('/invite/tok-abc', inviteRoutes)

    expect(await screen.findByText(/no longer valid/)).toBeInTheDocument()
  })
})
