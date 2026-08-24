// The invitation inbox on the trips list — an invitation that arrives without
// anyone having sent the link.
//
// The invitations are real rows addressed to the signed-in account, so what
// the screen says about who invited you, to what, and what you would see is
// the API's reading of those rows rather than a shape a stub returned.
import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OWNER_USER, PARTNER_USER, UNCONFIRMED_USER } from '../../server/testing/fixture'
import TripsList from '../pages/TripsList'
import { insert, remove, rows, signInAs } from './data'
import { renderAt } from './helpers'

interface MemberRow {
  trip_id: string
  user_id: string
  role: string
}
interface InviteRow {
  id: string
  declined_at: string | null
  accepted_at: string | null
}

/**
 * An invitation to trip-2, from its owner, addressed to whoever is asked for.
 *
 * `token_hash` is a hash and never a token: the plaintext exists only in the
 * response that mints one, so a row can carry anything here.
 */
const invite = (to: string, shows: Record<string, boolean> = {}) =>
  insert('trip_invites', [
    {
      id: 'inv-1',
      trip_id: 'trip-2',
      email: to,
      role: 'viewer',
      can_see_stays: true,
      can_see_flight: false,
      can_see_documents: false,
      can_see_shopping: false,
      token_hash: 'not-a-real-hash',
      invited_by: PARTNER_USER.id,
      expires_at: '2027-01-01T00:00:00.000Z',
      ...shows,
    },
  ])

const routes = [{ path: '/trips', element: <TripsList /> }]

beforeEach(async () => {
  // The owner's own trip would otherwise crowd the screen this is about.
  await remove('trip_members', 'user_id', OWNER_USER.id)
})

describe('the invitation inbox', () => {
  it('names who invited you, to what, and what you would see', async () => {
    await invite(OWNER_USER.email)
    renderAt('/trips', routes)

    expect(
      await screen.findByText(`${PARTNER_USER.display_name} invited you to Someone Else’s Trip`)
    ).toBeInTheDocument()
    // The flags on the row, said in the trip's own words.
    expect(screen.getByText(/You’ll also see where they’re staying\./)).toBeInTheDocument()
    expect(screen.getByText(/look, not change/)).toBeInTheDocument()
  })

  it('says so plainly when a viewer would see none of the bookings', async () => {
    await invite(OWNER_USER.email, { can_see_stays: false })
    renderAt('/trips', routes)

    expect(await screen.findByText(/The bookings and documents stay private\./)).toBeInTheDocument()
  })

  it('accepts, and refreshes the trips list rather than navigating', async () => {
    await invite(OWNER_USER.email)
    renderAt('/trips', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }))

    // Joining is what accepting means — the membership row is the proof.
    await waitFor(async () => {
      const members = await rows<MemberRow>('trip_members', 'user_id', OWNER_USER.id)
      expect(members).toEqual([expect.objectContaining({ trip_id: 'trip-2', role: 'viewer' })])
    })
  })

  it('declines without joining anything', async () => {
    await invite(OWNER_USER.email)
    renderAt('/trips', routes)

    await userEvent.click(await screen.findByRole('button', { name: 'No thanks' }))

    await waitFor(async () => {
      const [row] = await rows<InviteRow>('trip_invites', 'id', 'inv-1')
      expect(row.declined_at).not.toBeNull()
      expect(row.accepted_at).toBeNull()
    })
    expect(await rows<MemberRow>('trip_members', 'user_id', OWNER_USER.id)).toEqual([])
  })

  it('renders nothing at all when nothing is waiting', async () => {
    renderAt('/trips', routes)

    expect(await screen.findByText('Your trips')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })

  it('points an unconfirmed address at its inbox instead of showing nothing', async () => {
    // Anyone can type someone else's address at sign-up, so an unconfirmed one
    // is shown nothing until it is confirmed — and told why.
    await invite(UNCONFIRMED_USER.email)
    signInAs(UNCONFIRMED_USER)
    renderAt('/trips', routes)

    expect(await screen.findByText('Confirm your email address')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
  })
})
