// Signing out has to finish before the gate is allowed to look at the session.
//
// The bug this pins down: supabase.auth.signOut() clears its stored session
// asynchronously. Navigating to /gate without waiting for it meant the gate's
// restore effect read a session that was still there, called completeSignIn()
// and bounced straight back to /trips — apparently signed in, on a token whose
// refresh had just been revoked, until the next request 401'd.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignOutButton } from '../components/SignOutButton'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getSupabaseClient: vi.fn(),
  clearAccessCode: vi.fn(),
}))

vi.mock('../lib/supabaseClient', () => ({ getSupabaseClient: mocks.getSupabaseClient }))
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  clearAccessCode: mocks.clearAccessCode,
}))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

async function confirmSignOut() {
  const user = userEvent.setup()
  renderAt('/trips', [{ path: '/trips', element: <SignOutButton /> }])
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  // Both the icon button and the dialog's confirm are named "Sign out"; the
  // one that actually signs out is inside the dialog.
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Sign out' }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('signing out', () => {
  it('does not reach the gate until Supabase has cleared its session', async () => {
    // A signOut that hasn't settled yet — exactly the window the gate used to
    // race into.
    let finishSignOut: () => void = () => {}
    const signOut = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSignOut = resolve
        })
    )
    mocks.getSupabaseClient.mockReturnValue({ auth: { signOut } })

    await confirmSignOut()

    await waitFor(() => expect(signOut).toHaveBeenCalled())
    // The local token goes immediately, but the gate must not be reached yet.
    expect(mocks.clearAccessCode).toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()

    finishSignOut()
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/gate', { replace: true }))
  })

  it('still leaves when the revoke request fails', async () => {
    // The local session is gone either way; a network error must not strand
    // someone on a screen they asked to leave.
    mocks.getSupabaseClient.mockReturnValue({
      auth: { signOut: vi.fn().mockRejectedValue(new Error('offline')) },
    })

    await confirmSignOut()

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/gate', { replace: true }))
    expect(mocks.clearAccessCode).toHaveBeenCalled()
  })

  it('leaves even with Supabase unconfigured', async () => {
    mocks.getSupabaseClient.mockReturnValue(null)

    await confirmSignOut()

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/gate', { replace: true }))
  })
})
