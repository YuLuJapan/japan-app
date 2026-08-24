// Signing out has to finish before the gate is allowed to look at the session.
//
// The bug this pins down: supabase.auth.signOut() clears its stored session
// asynchronously. Navigating to /gate without waiting for it meant the gate's
// restore effect read a session that was still there, called completeSignIn()
// and bounced straight back to /trips — apparently signed in, on a token whose
// refresh had just been revoked, until the next request 401'd.
//
// Nothing here stands in for Supabase: the button holds the real client,
// signed in with a real password, and the sign-out really revokes the session
// on the stack's Auth service. What is arranged instead is the *network* the
// two talk over — a proxy in front of Auth that can hold the sign-out open, or
// drop it. Those are the two states the race and the offline case are about,
// and neither is reachable by asking a healthy server nicely.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, inject, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OWNER_USER } from '../../server/testing/fixture'
import { ANON_KEY, TEST_PASSWORD } from '../../server/testing/stack-config'
import { ACCESS_CODE_KEY } from '../api/client'
import { renderAt } from './helpers'

/** The one request this file cares about; everything else is passed straight on. */
const LOGOUT = '/auth/v1/logout'

interface Network {
  /** Origin to point VITE_SUPABASE_URL at. */
  url: string
  /** Hold the next sign-out open. Returns the release, which lets it through. */
  hold(): () => void
  /** Kill the connection mid-request, the way a lost signal does. */
  drop(): void
  /** How many sign-out requests have arrived. */
  attempts(): number
  close(): Promise<void>
}

/**
 * A real proxy in front of the stack's Auth service.
 *
 * Sign-in, session refresh and the token check all travel through it untouched
 * — this is Supabase Auth, at one remove. Only the sign-out request is held or
 * dropped, and only when a case asks for it.
 */
async function networkTo(target: string): Promise<Network> {
  let held: Promise<void> | null = null
  let dropping = false
  let attempts = 0

  const server: Server = createServer(async (req, res) => {
    const path = req.url ?? '/'
    const body: Buffer[] = []
    for await (const chunk of req) body.push(chunk as Buffer)

    if (path.startsWith(LOGOUT)) {
      attempts += 1
      if (dropping) {
        req.socket.destroy()
        return
      }
      if (held) await held
    }

    const headers = { ...req.headers }
    // Rewritten by the hop: the upstream is a different host, and undici sizes
    // and frames the forwarded body itself.
    for (const drop of ['host', 'connection', 'content-length', 'transfer-encoding'])
      delete headers[drop]

    const upstream = await fetch(`${target}${path}`, {
      method: req.method,
      headers: headers as Record<string, string>,
      body: body.length ? Buffer.concat(body) : undefined,
    })
    const payload = Buffer.from(await upstream.arrayBuffer())
    const out = Object.fromEntries(upstream.headers)
    // fetch has already decoded and re-framed the body; the upstream's own
    // framing headers would now describe something else.
    for (const drop of ['content-encoding', 'content-length', 'transfer-encoding']) delete out[drop]

    res.writeHead(upstream.status, out)
    res.end(payload)
  })

  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    hold() {
      let release: () => void = () => {}
      held = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        held = null
        release()
      }
    },
    drop() {
      dropping = true
    },
    attempts: () => attempts,
    close: () => new Promise<void>((closed) => server.close(() => closed())),
  }
}

let net: Network

/**
 * Builds the button against a configured or unconfigured Supabase.
 *
 * The modules are reset each time because lib/supabaseClient caches its client
 * on first use — right in a browser, where the configuration cannot change
 * under it, and what has to be undone to render both shapes in one file.
 */
async function loadSignOut({ auth }: { auth: string | null }) {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', auth ?? '')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', auth ? ANON_KEY : '')
  const { SignOutButton } = await import('../components/SignOutButton')
  const { getSupabaseClient } = await import('../lib/supabaseClient')
  return { SignOutButton, supabase: getSupabaseClient() }
}

/** Signed in for real, so there is a session for the sign-out to revoke. */
async function signedIn() {
  const { SignOutButton, supabase } = await loadSignOut({ auth: net.url })
  const { error } = await supabase!.auth.signInWithPassword({
    email: OWNER_USER.email,
    password: TEST_PASSWORD,
  })
  if (error) throw new Error(`signing in for the test failed: ${error.message}`)
  return { SignOutButton, supabase: supabase! }
}

async function confirmSignOut(SignOutButton: () => JSX.Element) {
  const user = userEvent.setup()
  renderAt('/trips', [
    { path: '/trips', element: <SignOutButton /> },
    { path: '/gate', element: <p>the gate</p> },
  ])
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  // Both the icon button and the dialog's confirm are named "Sign out"; the
  // one that actually signs out is inside the dialog.
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'Sign out' }))
}

beforeAll(async () => {
  net = await networkTo(inject('supabaseUrl'))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await net.close()
})

describe('signing out', () => {
  it('does not reach the gate until Supabase has cleared its session', async () => {
    const { SignOutButton, supabase } = await signedIn()
    // The sign-out is left in flight — exactly the window the gate used to
    // race into.
    const release = net.hold()

    await confirmSignOut(SignOutButton)

    await waitFor(() => expect(net.attempts()).toBe(1))
    // The local token goes immediately, but the gate must not be reached while
    // Supabase still holds the session.
    expect(localStorage.getItem(ACCESS_CODE_KEY)).toBeNull()
    expect(screen.queryByText('the gate')).not.toBeInTheDocument()

    release()

    expect(await screen.findByText('the gate')).toBeInTheDocument()
    const { data } = await supabase.auth.getSession()
    expect(data.session).toBeNull()
  })

  it('still leaves when the revoke request fails', async () => {
    const { SignOutButton } = await signedIn()
    // The local session is gone either way; a network error must not strand
    // someone on a screen they asked to leave.
    net.drop()

    await confirmSignOut(SignOutButton)

    expect(await screen.findByText('the gate')).toBeInTheDocument()
    // More than one: undici retries a connection that died before it answered.
    expect(net.attempts()).toBeGreaterThan(0)
    expect(localStorage.getItem(ACCESS_CODE_KEY)).toBeNull()
  })

  it('leaves even with Supabase unconfigured', async () => {
    const { SignOutButton, supabase } = await loadSignOut({ auth: null })
    expect(supabase).toBeNull()

    await confirmSignOut(SignOutButton)

    expect(await screen.findByText('the gate')).toBeInTheDocument()
  })
})
