// The sign-in screen. Two shapes, decided entirely by whether Supabase Auth is
// configured: with it, Google and email+password are live; without it, both
// degrade to disabled and the access code — the deprecated path — still works
// exactly as before. Apple stays disabled either way (no credentials yet).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AccessGate from '../pages/AccessGate'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  getSupabaseClient: vi.fn(() => null as unknown),
}))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

vi.mock('../lib/supabaseClient', () => ({ getSupabaseClient: mocks.getSupabaseClient }))

/** A Supabase client stub with only the auth calls this screen makes. */
function supabaseStub(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn(),
      ...overrides,
    },
  }
}

const routes = [
  { path: '/gate', element: <AccessGate /> },
  { path: '/trips', element: <p>trips page</p> },
]

beforeEach(() => {
  mocks.post.mockReset()
  mocks.getSupabaseClient.mockReturnValue(null)
  localStorage.clear()
})

describe('AccessGate — Supabase Auth not configured', () => {
  it('disables every account path and leaves the access code working', () => {
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

describe('AccessGate — Supabase Auth configured', () => {
  it('hands off to Google, returning to the gate so the session is picked up', async () => {
    const supabase = supabaseStub()
    mocks.getSupabaseClient.mockReturnValue(supabase)
    renderAt('/gate', routes)

    await userEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))

    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: expect.stringContaining('/gate') },
    })
  })

  it('signs in with email and password, then verifies the token server-side', async () => {
    const supabase = supabaseStub({
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 'jwt-123' } }, error: null }),
    })
    mocks.getSupabaseClient.mockReturnValue(supabase)
    mocks.post.mockResolvedValue({ ok: true, role: 'owner' })
    renderAt('/gate', routes)

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.type(screen.getByLabelText('Email'), 'yuval@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter22')
    await userEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))

    expect(await screen.findByText('trips page')).toBeInTheDocument()
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'yuval@example.com',
      password: 'hunter22',
    })
    // The Supabase JWT is what the API sees — the gate never trusts it alone.
    expect(mocks.post).toHaveBeenCalledWith('/auth/verify', { code: 'jwt-123' })
  })

  it('creates an account and waits for confirmation when no session comes back', async () => {
    const supabase = supabaseStub()
    mocks.getSupabaseClient.mockReturnValue(supabase)
    renderAt('/gate', routes)

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.click(screen.getByRole('button', { name: /Create an account/ }))
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter22')
    await userEvent.click(screen.getByRole('button', { name: /^Create account$/ }))

    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
    expect(supabase.auth.signUp).toHaveBeenCalled()
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('rewords a bad-credentials error instead of showing the raw message', async () => {
    const supabase = supabaseStub({
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ data: {}, error: new Error('Invalid login credentials') }),
    })
    mocks.getSupabaseClient.mockReturnValue(supabase)
    renderAt('/gate', routes)

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.type(screen.getByLabelText('Email'), 'yuval@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))

    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument()
    expect(screen.queryByText('trips page')).not.toBeInTheDocument()
  })

  it('still offers a magic link from the email screen', async () => {
    const supabase = supabaseStub()
    mocks.getSupabaseClient.mockReturnValue(supabase)
    renderAt('/gate', routes)

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.type(screen.getByLabelText('Email'), 'yuval@example.com')
    await userEvent.click(screen.getByRole('button', { name: /Email me a sign-in link instead/ }))

    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
    expect(supabase.auth.signInWithOtp).toHaveBeenCalled()
  })

  it('signs out and explains when the account is not allow-listed', async () => {
    const supabase = supabaseStub({
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 'stranger-jwt' } } }),
    })
    mocks.getSupabaseClient.mockReturnValue(supabase)
    mocks.post.mockRejectedValue(new Error('unauthorized'))
    renderAt('/gate', routes)

    expect(await screen.findByText(/isn’t set up for owner access/)).toBeInTheDocument()
    expect(supabase.auth.signOut).toHaveBeenCalled()
    expect(screen.queryByText('trips page')).not.toBeInTheDocument()
  })
})
