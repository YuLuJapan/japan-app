// The two sharing screens: the roster (which adapts to your role) and the
// link you land on when someone shares a trip with you.
//
// The roster is real membership rows read back through the API, and the invite
// link is a token the server really minted — so "only shown once" is tested
// against the one response that carries it.
import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OWNER_USER, PARTNER_USER, VIEWER_USER } from '../../server/testing/fixture'
import { api } from '../api/client'
import AcceptInvite from '../pages/AcceptInvite'
import TripMembers from '../pages/TripMembers'
import { insert, rows, signInAs } from './data'
import { renderAt } from './helpers'

interface MemberRow {
  user_id: string
  role: string
  can_see_flight: boolean
}

const membersRoutes = [{ path: '/trips/:tripId/members', element: <TripMembers /> }]

/** The friend the trip is shared with — a viewer who sees the stays and no more. */
const shareWithFriend = () =>
  insert('trip_members', [
    {
      trip_id: 'trip-1',
      user_id: VIEWER_USER.id,
      role: 'viewer',
      can_see_stays: true,
      can_see_flight: false,
      can_see_documents: false,
      can_see_shopping: false,
    },
  ])

beforeEach(async () => {
  await shareWithFriend()
})

describe('the roster adapts to your role', () => {
  it('lets an owner change a role and a viewer’s visibility', async () => {
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByText('Friend')).toBeInTheDocument()
    expect(screen.getByLabelText('Access for Friend')).toBeInTheDocument()
    // Two sets of the three toggles: the viewer's own row, and the invite form.
    // The owner is not offered any — writers ignore the flags entirely.
    expect(screen.getAllByText('Where we’re staying')).toHaveLength(2)
    expect(screen.queryByLabelText('Access for Yuval')).toBeInTheDocument()
  })

  it('saves a member’s access on a button, not on every click', async () => {
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByText('Friend')).toBeInTheDocument()
    // Nothing to save until something is changed.
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()

    // The viewer's own row is the first of the two 'Flights' toggles; the
    // second belongs to the invite form below it.
    await userEvent.click(screen.getAllByLabelText(/Flights/)[0])
    // Still nothing written — the toggle only stages the change.
    const before = await rows<MemberRow>('trip_members', 'user_id', VIEWER_USER.id)
    expect(before[0].can_see_flight).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    // Role and all the flags travel together in one patch.
    const after = await rows<MemberRow>('trip_members', 'user_id', VIEWER_USER.id)
    expect(after[0]).toMatchObject({ role: 'viewer', can_see_flight: true })
  })

  it('keeps the edit and says why when the server refuses it', async () => {
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByText('Yuval')).toBeInTheDocument()
    // Demoting the only owner. The server's refusal is the real rule, and the
    // wording below is the server's own.
    await userEvent.selectOptions(screen.getByLabelText('Access for Yuval'), 'viewer')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/left with no owner/)).toBeInTheDocument()
    // The refusal does not silently snap the control back — the choice is
    // still there to correct or discard.
    expect(screen.getByLabelText('Access for Yuval')).toHaveValue('viewer')
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('offers a way back to Essentials, the only screen that leads here', async () => {
    signInAs(VIEWER_USER)
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByRole('link', { name: 'Essentials' })).toHaveAttribute(
      'href',
      '/trips/trip-1/essentials'
    )
  })

  it('shows a partner the roster read-only, with a viewer-only invite', async () => {
    await insert('trip_members', [
      {
        trip_id: 'trip-1',
        user_id: PARTNER_USER.id,
        role: 'partner',
        can_see_stays: true,
        can_see_flight: true,
        can_see_documents: true,
        can_see_shopping: true,
      },
    ])
    signInAs(PARTNER_USER)
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
    signInAs(VIEWER_USER)
    renderAt('/trips/trip-1/members', membersRoutes)

    expect(await screen.findByText('Friend')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Create invite link/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Access for Friend')).not.toBeInTheDocument()
  })

  it('surfaces the minted link once, with the copy-it-now warning', async () => {
    renderAt('/trips/trip-1/members', membersRoutes)

    await userEvent.click(await screen.findByRole('button', { name: /Create invite link/ }))

    expect(await screen.findByText(/only shown once/)).toBeInTheDocument()
    // The token is the server's, and it is nowhere in the stored row: what is
    // kept is a hash, which is why this is the only chance to read it.
    expect(screen.getByText(/\/invite\/\w+/)).toBeInTheDocument()
    const [minted] = await rows<{ role: string; can_see_flight: boolean }>(
      'trip_invites',
      'trip_id',
      'trip-1'
    )
    expect(minted).toMatchObject({ role: 'viewer', can_see_flight: true })
  })
})

const inviteRoutes = [
  { path: '/invite/:token', element: <AcceptInvite /> },
  { path: '/gate', element: <p>sign in page</p> },
  { path: '/trips/:tripId', element: <p>the trip</p> },
]

/** Mints a real invite to trip-2 through the API, and returns its token. */
async function mintInvite(): Promise<string> {
  signInAs(PARTNER_USER) // trip-2's owner
  const { token } = await api.post<{ token: string }>('/trips/trip-2/invites', {
    role: 'viewer',
    can_see_stays: true,
    can_see_flight: false,
    can_see_documents: false,
    can_see_shopping: false,
  })
  return token
}

describe('opening an invite link', () => {
  it('sends a signed-out visitor to sign in, remembering the link', async () => {
    const token = await mintInvite()
    localStorage.clear()
    sessionStorage.clear()
    renderAt(`/invite/${token}`, inviteRoutes)

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('sign in page')).toBeInTheDocument()
    expect(sessionStorage.getItem('pending_invite')).toBe(token)
  })

  it('says what the link grants, then joins', async () => {
    const token = await mintInvite()
    signInAs(OWNER_USER) // somebody who is not on trip-2 yet
    renderAt(`/invite/${token}`, inviteRoutes)

    expect(await screen.findByText('Someone Else’s Trip')).toBeInTheDocument()
    expect(
      screen.getByText(new RegExp(`${PARTNER_USER.display_name} invited you to`))
    ).toBeInTheDocument()
    // Only the things the invite actually turns on are listed.
    expect(screen.getByText(/where you’re staying/)).toBeInTheDocument()
    expect(screen.queryByText(/the flights/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Join this trip' }))
    expect(await screen.findByText('the trip')).toBeInTheDocument()
    const joined = await rows<MemberRow>('trip_members', 'user_id', OWNER_USER.id)
    expect(joined.map((m) => m.role)).toContain('viewer')
  })

  it('explains a dead link instead of failing silently', async () => {
    renderAt('/invite/no-such-token', inviteRoutes)

    expect(await screen.findByText(/no longer valid/)).toBeInTheDocument()
  })
})
