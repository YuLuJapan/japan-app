// The sign-in screen. Two shapes, decided entirely by whether Supabase Auth is
// configured: with it, Google and email+password are live; without it there is
// no way in at all, and the buttons say so rather than failing on tap. Apple
// stays disabled either way (no credentials yet).
//
// The shared access code used to be the fallback here. It is gone, so an
// unconfigured deployment is genuinely unusable — which is the honest state,
// and better than a door that reaches every trip in the database.
//
// "Configured" here means the env vars really are set and lib/supabaseClient
// really builds a client against the stack's Auth service, so the sign-ins
// below are sign-ins: a real password checked by a real GoTrue, and the token
// it returns proved against the real /me.
import { afterEach, describe, expect, it, inject, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_USER } from '../../server/testing/fixture'
import { ANON_KEY, TEST_PASSWORD } from '../../server/testing/stack-config'
import { createAccount } from './data'
import { renderAt } from './helpers'

const supabaseUrl = inject('supabaseUrl')

const routes = (Gate: () => JSX.Element) => [
  { path: '/gate', element: <Gate /> },
  { path: '/trips', element: <p>trips page</p> },
]

/**
 * Renders the gate with Auth configured or not.
 *
 * The modules are reset each time because lib/supabaseClient caches its client
 * on first use — which is right in a browser, where the configuration cannot
 * change under it, and is exactly what has to be undone to render both shapes
 * in one file.
 */
async function configureAuth({ configured }: { configured: boolean }) {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', configured ? supabaseUrl : '')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', configured ? ANON_KEY : '')
  const { default: AccessGate } = await import('../pages/AccessGate')
  const { getSupabaseClient } = await import('../lib/supabaseClient')
  return {
    /** Mount the gate. Separate from the above so a case can arrange the
     *  session, or watch the client, before the restore effect runs. */
    mount: () => renderAt('/gate', routes(AccessGate)),
    supabase: getSupabaseClient() as SupabaseClient | null,
  }
}

/** Configure and mount in one go, for the cases that need nothing in between. */
async function renderGate({ configured }: { configured: boolean }) {
  const gate = await configureAuth({ configured })
  gate.mount()
  return gate.supabase
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('AccessGate — Supabase Auth not configured', () => {
  it('disables every way in, and offers no code box to fall back to', async () => {
    await renderGate({ configured: false })

    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Continue with Apple ID/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Continue with email/ })).toBeDisabled()
    expect(screen.queryByLabelText('Access code')).not.toBeInTheDocument()
  })
})

describe('AccessGate — Supabase Auth configured', () => {
  it('hands off to Google, returning to the gate so the session is picked up', async () => {
    const supabase = (await renderGate({ configured: true }))!
    // OAuth ends in a full-page redirect, which jsdom cannot perform — so the
    // handoff is observed on the real client rather than followed.
    const handoff = vi.spyOn(supabase.auth, 'signInWithOAuth').mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/auth' },
      error: null,
    })

    await userEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))

    expect(handoff).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: expect.stringContaining('/gate') },
    })
  })

  it('signs in with email and password, then checks the token against the API', async () => {
    await renderGate({ configured: true })

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.type(screen.getByLabelText('Email'), OWNER_USER.email)
    await userEvent.type(screen.getByLabelText('Password'), TEST_PASSWORD)
    await userEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))

    // Supabase saying yes is not this app saying yes: the token is stored and
    // then proved against /me before the screen navigates anywhere. Landing on
    // the trips page means both happened.
    expect(await screen.findByText('trips page')).toBeInTheDocument()
    expect(localStorage.getItem('trip_access_code')).toBeTruthy()
  })

  it('creates an account and waits for confirmation when no session comes back', async () => {
    const supabase = (await renderGate({ configured: true }))!
    // The test stack confirms addresses on the spot — it has no SMTP, and
    // accounts that could not sign in would be useless to every other file. A
    // project with confirmations on answers a sign-up with a user and no
    // session, which is the answer this screen has to handle, so that is what
    // the client is asked to give here.
    const signedUp = vi.spyOn(supabase.auth, 'signUp').mockResolvedValue({
      data: { user: { id: 'pending' }, session: null },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.signUp>>)

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.click(screen.getByRole('button', { name: /Create an account/ }))
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter22')
    await userEvent.click(screen.getByRole('button', { name: /^Create account$/ }))

    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
    expect(signedUp).toHaveBeenCalled()
    expect(screen.queryByText('trips page')).not.toBeInTheDocument()
  })

  it('rewords a bad-credentials error instead of showing the raw message', async () => {
    await renderGate({ configured: true })

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.type(screen.getByLabelText('Email'), OWNER_USER.email)
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))

    // "Invalid login credentials" is GoTrue's wording; this is ours.
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument()
    expect(screen.queryByText('trips page')).not.toBeInTheDocument()
  })

  it('still offers a magic link from the email screen', async () => {
    const supabase = (await renderGate({ configured: true }))!
    // No SMTP is configured on the test stack, so sending is observed rather
    // than performed — the screen's job is to ask for one and say so.
    const sent = vi
      .spyOn(supabase.auth, 'signInWithOtp')
      .mockResolvedValue({ data: { user: null, session: null }, error: null })

    await userEvent.click(screen.getByRole('button', { name: /Continue with email/ }))
    await userEvent.type(screen.getByLabelText('Email'), OWNER_USER.email)
    await userEvent.click(screen.getByRole('button', { name: /Email me a sign-in link instead/ }))

    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
    expect(sent).toHaveBeenCalled()
  })

  it('signs back out when the API refuses a session Supabase accepted', async () => {
    // A session for an account that no longer exists: Supabase still holds it,
    // and the API refuses the token because Auth no longer knows the user.
    const stranger = await createAccount('stranger@example.com')
    const { mount, supabase } = await configureAuth({ configured: true })
    await supabase!.auth.signInWithPassword({
      email: 'stranger@example.com',
      password: TEST_PASSWORD,
    })
    await stranger.remove()

    // Watched before mounting: the gate's restore effect runs on mount, and
    // the client it uses is this one.
    const signedOut = vi.spyOn(supabase!.auth, 'signOut')
    mount()

    expect(await screen.findByText(/didn’t accept the session/)).toBeInTheDocument()
    expect(signedOut).toHaveBeenCalled()
    expect(screen.queryByText('trips page')).not.toBeInTheDocument()
  })
})
