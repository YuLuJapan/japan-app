// The sign-in screen. Two shapes, decided entirely by whether Supabase Auth is
// configured: with it, Google and email+password are live; without it there is
// no way in at all, and the buttons say so rather than failing on tap. Apple
// stays disabled either way (no credentials yet).
//
// The shared access code used to be the fallback here. It is gone, so an
// unconfigured deployment is genuinely unusable — which is the honest state,
// and better than a door that reaches every trip in the database.
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
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.getSupabaseClient.mockReturnValue(null)
  localStorage.clear()
  window.history.replaceState({}, '', '/gate')
})

describe('AccessGate — Supabase Auth not configured', () => {
  it('disables every way in, and offers no code box to fall back to', () => {
    renderAt('/gate', routes)

    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Continue with Apple ID/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Continue with email/ })).toBeDisabled()
    expect(screen.queryByLabelText('Access code')).not.toBeInTheDocument()
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

  it('signs in with email and password, then checks the token against the API', async () => {
    const supabase = supabaseStub({
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 'jwt-123' } }, error: null }),
    })
    mocks.getSupabaseClient.mockReturnValue(supabase)
    mocks.get.mockResolvedValue({ user: { id: 'user-1' } })
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
    // Supabase saying yes is not this app saying yes: the token is stored and
    // then proved against /me before the screen navigates anywhere.
    expect(localStorage.getItem('trip_access_code')).toBe('jwt-123')
    expect(mocks.get).toHaveBeenCalledWith('/me')
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

  it('signs back out when the API refuses a session Supabase accepted', async () => {
    const supabase = supabaseStub({
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 'stranger-jwt' } } }),
    })
    mocks.getSupabaseClient.mockReturnValue(supabase)
    mocks.get.mockRejectedValue(new Error('unauthorized'))
    renderAt('/gate', routes)

    expect(await screen.findByText(/didn’t accept the session/)).toBeInTheDocument()
    expect(supabase.auth.signOut).toHaveBeenCalled()
    expect(screen.queryByText('trips page')).not.toBeInTheDocument()
  })
})

// Google and the magic link both leave the page and come back to /gate with
// the session in the URL. Reading it and proving it against /me takes a moment,
// and the screen must not spend that moment claiming nobody is signed in.
describe('AccessGate — coming back from a redirect', () => {
  it('says it is signing you in instead of offering the buttons again', async () => {
    const supabase = supabaseStub({
      getSession: vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ data: { session: { access_token: 'jwt-123' } } }), 20)
          })
      ),
    })
    mocks.getSupabaseClient.mockReturnValue(supabase)
    mocks.get.mockResolvedValue({ user: { id: 'user-1' } })
    window.history.replaceState({}, '', '/gate?code=oauth-code')
    renderAt('/gate', routes)

    expect(screen.getByText('Signing you in…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Continue with Google/ })).not.toBeInTheDocument()
    expect(await screen.findByText('trips page')).toBeInTheDocument()
  })

  it('offers the ways in again when the redirect brought no session', async () => {
    const supabase = supabaseStub()
    mocks.getSupabaseClient.mockReturnValue(supabase)
    window.history.replaceState({}, '', '/gate#access_token=stale')
    renderAt('/gate', routes)

    expect(screen.getByText('Signing you in…')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Continue with Google/ })).toBeInTheDocument()
  })

  it('shows the same wait while handing off to Google', async () => {
    const supabase = supabaseStub()
    mocks.getSupabaseClient.mockReturnValue(supabase)
    renderAt('/gate', routes)

    await userEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))

    expect(screen.getByText('Signing you in…')).toBeInTheDocument()
  })
})
