// The acceptance screen. It sits after sign-in rather than as a tick-box on
// the sign-up form, because Google and the magic link both leave the page and
// come back — a checkbox there would cover one way in out of three.
//
// The gate asks the real /me, and accepting writes a real profiles row, so
// "the server stamps its own version" is asserted where the version ends up
// rather than by inspecting a request body.
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CURRENT_TERMS_VERSION } from '../../server/src/lib/terms'
import { OWNER_USER } from '../../server/testing/fixture'
import { withTableMissing } from '../../server/testing/db'
import { ACCESS_CODE_KEY } from '../api/client'
import { TermsGate } from '../components/TermsGate'
import { patchRow, rows } from './data'
import { renderAt } from './helpers'

interface ProfileRow {
  accepted_terms_at: string | null
  accepted_terms_version: string | null
}

/** The fixture's accounts have never accepted; this is the other state. */
const alreadyAccepted = () =>
  patchRow('profiles', OWNER_USER.id, {
    accepted_terms_at: new Date().toISOString(),
    accepted_terms_version: CURRENT_TERMS_VERSION,
  })

const renderGate = () =>
  renderAt('/trips', [{ path: '/trips', element: <TermsGate>the app</TermsGate> }])

describe('TermsGate', () => {
  it('lets an account that has accepted straight through', async () => {
    await alreadyAccepted()
    renderGate()
    expect(await screen.findByText('the app')).toBeInTheDocument()
  })

  it('blocks an account that has not, and links both documents', async () => {
    renderGate()
    expect(await screen.findByRole('link', { name: /terms of use/i })).toHaveAttribute(
      'href',
      '/terms'
    )
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/privacy'
    )
    expect(screen.queryByText('the app')).not.toBeInTheDocument()
  })

  it('sends no version — the server stamps its own', async () => {
    const user = userEvent.setup()
    renderGate()

    await user.click(await screen.findByRole('button', { name: /i agree/i }))

    // The client never names a version; what lands in the row is the server's,
    // which is what stops anyone accepting text they were not shown.
    await waitFor(async () => {
      const [profile] = await rows<ProfileRow>('profiles', 'id', OWNER_USER.id)
      expect(profile.accepted_terms_version).toBe(CURRENT_TERMS_VERSION)
      expect(profile.accepted_terms_at).not.toBeNull()
    })
  })

  it('says so when accepting fails, rather than looking stuck', async () => {
    const user = userEvent.setup()
    renderGate()
    await screen.findByRole('button', { name: /i agree/i })

    // A save that really cannot land: the table is gone for the duration.
    await withTableMissing('profiles', async () => {
      await user.click(screen.getByRole('button', { name: /i agree/i }))
      expect(await screen.findByText(/didn’t save/i)).toBeInTheDocument()
    })
  })

  it('does not demand agreement when /me itself is broken', async () => {
    // The app has bigger problems, and the screens below explain them better.
    // A token the Auth service refuses is one way to have them.
    localStorage.setItem(ACCESS_CODE_KEY, 'not-a-real-token')
    renderGate()
    expect(await screen.findByText('the app')).toBeInTheDocument()
  })
})
