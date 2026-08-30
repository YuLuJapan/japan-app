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
import { setAccessCode } from '../api/client'
import AccessGate from '../pages/AccessGate'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  getSupabaseClient: vi.fn(() => null as unknown),
}))

const captured = vi.hoisted(() => ({ events: [] as { name: string; props?: unknown }[] }))

vi.mock('../lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/posthog')>()),
  capture: (name: string, props?: unknown) => captured.events.push({ name, props }),
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
  captured.events = []
  localStorage.clear()
  window.history.replaceState({}, '', '/gate')
})

/** The events of one name, in the order they were captured. */
const eventsNamed = (name: string) =>
  captured.events.filter((event) => event.name === name).map((event) => event.props)

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

// What a sign-in reports, and why it is reported from here.
//
// supabase-js emits `SIGNED_IN` for a session merely restored from storage — at
// start-up and on every return to the tab — so the auth listener that used to
// send `user_signed_in` was counting app opens, and never the sign-in itself:
// that one happens while this screen is still on the page, before SessionProvider
// (inside RequireAccess) has mounted. The gate knows both which credential was
// used and whether the API accepted it, so it is the one that says so.
describe('AccessGate — reporting the way in', () => {
  const session = (provider = 'email') => ({
    access_token: 'jwt-123',
    user: { app_metadata: { provider } },
  })

  /** A redirect landing on the gate with `hash`, answered by `getSession`. */
  function arriveWith(hash: string, sessionValue: unknown) {
    const supabase = supabaseStub({
      getSession: vi.fn().mockResolvedValue({ data: { session: sessionValue } }),
    })
    mocks.getSupabaseClient.mockReturnValue(supabase)
    window.history.replaceState({}, '', `/gate${hash}`)
    renderAt('/gate', routes)
    return supabase
  }

  it('reports a magic link as one, where the provider only says "email"', async () => {
    mocks.get.mockResolvedValue({ user: { id: 'user-1' } })
    arriveWith('#access_token=jwt-123&type=magiclink', session())

    expect(await screen.findByText('trips page')).toBeInTheDocument()
    expect(eventsNamed('user_signed_in')).toEqual([{ method: 'magic_link' }])
    expect(eventsNamed('login_link_opened')).toEqual([
      { link_type: 'magic_link', outcome: 'signed_in' },
    ])
  })

  it('names the provider when no link brought them here', async () => {
    mocks.get.mockResolvedValue({ user: { id: 'user-1' } })
    arriveWith('#access_token=jwt-123&provider_token=ya29', session('google'))

    expect(await screen.findByText('trips page')).toBeInTheDocument()
    expect(eventsNamed('user_signed_in')).toEqual([{ method: 'google' }])
    expect(eventsNamed('login_link_opened')).toEqual([])
  })

  it('reports a link that was tapped too late — the click no other event sees', async () => {
    arriveWith('#error=access_denied&error_code=otp_expired', null)

    expect(await screen.findByRole('button', { name: /Continue with Google/ })).toBeInTheDocument()
    expect(eventsNamed('login_link_opened')).toEqual([
      { link_type: 'unknown', outcome: 'no_session', error_code: 'otp_expired' },
    ])
    expect(eventsNamed('user_signed_in')).toEqual([])
  })

  it('separates a link this app refused from one Supabase refused', async () => {
    mocks.get.mockRejectedValue(new Error('unauthorized'))
    arriveWith('#access_token=jwt-123&type=magiclink', session())

    expect(await screen.findByText(/didn’t accept the session/)).toBeInTheDocument()
    expect(eventsNamed('login_link_opened')).toEqual([
      { link_type: 'magic_link', outcome: 'refused' },
    ])
    expect(eventsNamed('user_signed_in')).toEqual([])
  })

  it('says nothing when a live session is merely restored', async () => {
    // No redirect payload in the URL: this is someone re-opening the app with
    // the last session still valid, which is exactly what the old listener
    // counted as a sign-in.
    setAccessCode('stored-jwt')
    mocks.get.mockResolvedValue({ user: { id: 'user-1' } })
    arriveWith('', session())

    expect(await screen.findByText('trips page')).toBeInTheDocument()
    expect(captured.events).toEqual([])
  })

  it('reports the link being sent, so a click has something to be a share of', async () => {
    const supabase = supabaseStub()
    mocks.getSupabaseClient.mockReturnValue(supabase)
    renderAt('/gate', routes)

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.type(screen.getByLabelText('Email'), 'yuval@example.com')
    await userEvent.click(screen.getByRole('button', { name: /Email me a sign-in link instead/ }))

    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
    expect(eventsNamed('login_link_sent')).toEqual([{ link_type: 'magic_link' }])
  })

  it('reports a password sign-in as a password', async () => {
    const supabase = supabaseStub({
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: session() }, error: null }),
    })
    mocks.getSupabaseClient.mockReturnValue(supabase)
    mocks.get.mockResolvedValue({ user: { id: 'user-1' } })
    renderAt('/gate', routes)

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.type(screen.getByLabelText('Email'), 'yuval@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter22')
    await userEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))

    expect(await screen.findByText('trips page')).toBeInTheDocument()
    expect(eventsNamed('user_signed_in')).toEqual([{ method: 'password' }])
  })
})
