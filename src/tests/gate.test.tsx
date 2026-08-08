// The sign-in screen: Google/Apple are visible but disabled (no OAuth
// credentials yet), magic-link email is offered only when Supabase Auth is
// configured (unset in tests, so it degrades to disabled), and the access
// code path — the one exercised end to end — still works exactly as before.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccessGate from '../pages/AccessGate'
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

const routes = [
  { path: '/gate', element: <AccessGate /> },
  { path: '/trips', element: <p>trips page</p> },
]

describe('AccessGate', () => {
  it('shows Google/Apple disabled and email disabled when Supabase Auth is not configured', () => {
    renderAt('/gate', routes)

    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Continue with Apple ID/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Continue with email/ })).toBeDisabled()
    expect(screen.getByLabelText('Access code')).toBeInTheDocument()
  })

  it('signs in with the right access code', async () => {
    mocks.post.mockResolvedValue({ ok: true, role: 'owner' })
    renderAt('/gate', routes)

    await userEvent.type(screen.getByLabelText('Access code'), 'japan2026')
    await userEvent.click(screen.getByRole('button', { name: /Enter with access code/ }))

    expect(await screen.findByText('trips page')).toBeInTheDocument()
    expect(mocks.post).toHaveBeenCalledWith('/auth/verify', { code: 'japan2026' })
  })

  it('shows an error for a wrong code and does not navigate', async () => {
    mocks.post.mockRejectedValue(new Error('unauthorized'))
    renderAt('/gate', routes)

    await userEvent.type(screen.getByLabelText('Access code'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: /Enter with access code/ }))

    expect(await screen.findByText('Wrong code — try again.')).toBeInTheDocument()
    expect(screen.queryByText('trips page')).not.toBeInTheDocument()
  })
})
