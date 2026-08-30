// The sign-in screen, rebuilt on the 2026-08-30 design: the app's own travel
// footage full-bleed behind the mark, the name and the two ways in, with
// everything readable sitting on the scrim rather than on a coral panel.
//
// The Apple button went with the rebuild. It had been disabled since it was
// added — there are no Apple credentials — and the design draws two buttons,
// not three greyed-out promises. Nothing was wired to it, so nothing but the
// row is gone; add it back next to Google when the credentials exist.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, clearAccessCode, getAccessCode, setAccessCode } from '../api/client'
import { GateBackdrop } from '../components/GateBackdrop'
import { RingMark } from '../components/RingMark'
import { capture } from '../lib/posthog'
import { getSupabaseClient } from '../lib/supabaseClient'

type Screen = 'choose' | 'email' | 'sent' | 'resolving'
type Mode = 'signin' | 'signup'

/**
 * Is a sign-in already in flight as this screen mounts?
 *
 * Google and the magic link both leave the page and come back to /gate with
 * the session in the URL — `?code=` for the PKCE flow supabase-js uses now,
 * `#access_token=` for the implicit one. Reading the URL takes supabase-js a
 * moment and proving the token against /me takes a round trip, and for that
 * second or two this screen used to render its full set of sign-in buttons:
 * someone who had just authenticated with Google was shown "Continue with
 * Google" again, as if it had not worked, and then bounced to the trips list
 * mid-tap.
 *
 * A stored token counts too — it means the last session is being restored
 * rather than started, which ends in the same navigation.
 */
function resumingSignIn(): boolean {
  const params = new URLSearchParams(window.location.search)
  const hash = window.location.hash
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return (
    params.has('code') ||
    fragment.has('access_token') ||
    fragment.has('refresh_token') ||
    !!getAccessCode()
  )
}

/**
 * Store the token, then prove the API accepts it before navigating.
 *
 * Supabase saying yes and this app saying yes are two different things — the
 * project could be misconfigured, or the API unreachable — and landing on a
 * trips list that immediately bounces back here is a worse first second than
 * an error on the gate.
 */
async function completeSignIn(token: string, navigate: (path: string, opts?: object) => void) {
  setAccessCode(token)
  await api.get<{ user: { id: string } }>('/me')
  navigate('/trips', { replace: true })
}

/** Supabase returns provider-shaped messages; these are the ones worth rewording. */
function readableAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Wrong email or password.'
  if (m.includes('email not confirmed')) return 'Confirm your email first — check your inbox.'
  if (m.includes('already registered'))
    return 'That email already has an account — sign in instead.'
  if (m.includes('password')) return 'Password must be at least 6 characters.'
  return 'Could not sign in — try again.'
}

export default function AccessGate() {
  // Resolved once, at mount: the URL still carries the redirect's payload
  // here, and supabase-js strips it as soon as it has read it.
  const [screen, setScreen] = useState<Screen>(() =>
    getSupabaseClient() && resumingSignIn() ? 'resolving' : 'choose'
  )
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const supabase = getSupabaseClient()

  // Landing back here after tapping the magic link or returning from Google:
  // Supabase has already parsed the session out of the URL by the time this runs.
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return
        if (!data.session) {
          // Nothing came back — a cancelled Google prompt, a link that had
          // already been used. Whatever the guess at mount was, there is
          // nobody to sign in, so offer the ways in again.
          setScreen((current) => (current === 'resolving' ? 'choose' : current))
          return
        }
        return completeSignIn(data.session.access_token, navigate).catch(() => {
          if (cancelled) return
          clearAccessCode()
          supabase.auth.signOut()
          setError('Signed in, but this app didn’t accept the session. Try again.')
          setScreen('choose')
        })
      })
      .catch(() => {
        if (cancelled) return
        setError('Could not check your sign-in — try again.')
        setScreen('choose')
      })
    return () => {
      cancelled = true
    }
  }, [supabase, navigate])

  async function signInWithGoogle() {
    if (!supabase || busy) return
    setBusy(true)
    setError(null)
    // Handing off to Google takes a beat of its own; say so rather than
    // leaving an unchanged button under a finger that has already tapped it.
    setScreen('resolving')
    // Redirects away; the useEffect above finishes the job on the way back.
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/gate` },
    })
    if (oauthError) {
      setError('Could not reach Google — try again.')
      setScreen('choose')
      setBusy(false)
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password || busy || !supabase) return
    setBusy(true)
    setError(null)
    try {
      const credentials = { email: email.trim(), password }
      const { data, error: authError } =
        mode === 'signup'
          ? await supabase.auth.signUp({
              ...credentials,
              options: { emailRedirectTo: `${window.location.origin}/gate` },
            })
          : await supabase.auth.signInWithPassword(credentials)
      if (authError) throw authError
      // Sign-up with email confirmation on returns no session — the account
      // exists but cannot be used until the link is tapped.
      if (!data.session) {
        setScreen('sent')
        return
      }
      // Only the *account creation* is reported here — this is the one place
      // that knows it was a sign-up rather than a sign-in. The session that
      // follows is reported by SessionProvider, which sees every path (Google
      // and the magic link never come back through this handler).
      if (mode === 'signup') capture('user_signed_up', { method: 'password' })
      await completeSignIn(data.session.access_token, navigate)
    } catch (err) {
      clearAccessCode()
      setError(
        err instanceof Error && err.message
          ? readableAuthError(err.message)
          : 'Could not sign in — try again.'
      )
    } finally {
      setBusy(false)
    }
  }

  async function sendMagicLink() {
    if (!email.trim() || busy || !supabase) return
    setBusy(true)
    setError(null)
    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/gate` },
      })
      if (sendError) throw sendError
      setScreen('sent')
    } catch {
      setError('Could not send the link — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-ink">
      <GateBackdrop />

      <div className="relative z-10 mx-auto flex w-full max-w-app flex-1 flex-col px-6 pt-16 pb-[max(2.25rem,env(safe-area-inset-bottom))]">
        {/* The mark and the name float in the middle of the picture; every way
            in sits at the bottom, under the thickest part of the scrim and
            within reach of a thumb. */}
        <div className="flex flex-1 flex-col items-center justify-center pb-10 text-center">
          <RingMark size={76} />
          <h1 className="on-photo mt-7 font-display text-[2.75rem] font-extrabold leading-none tracking-tight text-white">
            Onward
          </h1>
          <p className="on-photo mt-3 text-[15px] font-medium text-white/85">
            Every trip, one pocket
          </p>
        </div>

        <div className="w-full">
          {screen === 'resolving' && (
            <div className="flex flex-col items-center gap-3 py-6" role="status">
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/35 border-t-white" />
              <p className="on-photo text-sm font-semibold text-white">Signing you in…</p>
            </div>
          )}

          {screen === 'sent' && (
            <div className="flex flex-col gap-3">
              <p className="on-photo text-center text-sm font-semibold text-white">
                Check your email — we sent a sign-in link to {email.trim()}.
              </p>
              <button
                type="button"
                onClick={() => setScreen('choose')}
                className="on-photo text-center text-sm text-white/85 underline underline-offset-2"
              >
                Use a different way in
              </button>
            </div>
          )}

          {screen === 'email' && (
            <form onSubmit={submitPassword} className="flex w-full flex-col gap-3 text-left">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                className="field border-transparent text-center shadow-pop"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email"
              />
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="field border-transparent text-center shadow-pop"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
              />
              {error && (
                <p className="on-photo text-center text-sm font-semibold text-white">{error}</p>
              )}
              <button
                type="submit"
                className="btn min-h-[3.25rem] bg-white text-ink shadow-pop hover:bg-white/90"
                disabled={busy}
              >
                {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setMode(mode === 'signup' ? 'signin' : 'signup')
                }}
                className="on-photo py-1 text-center text-sm text-white/85 underline underline-offset-2"
              >
                {mode === 'signup' ? 'I already have an account' : 'Create an account'}
              </button>
              <button
                type="button"
                onClick={sendMagicLink}
                disabled={busy}
                className="on-photo py-1 text-center text-sm text-white/85 underline underline-offset-2"
              >
                Email me a sign-in link instead
              </button>
              <button
                type="button"
                onClick={() => setScreen('choose')}
                className="on-photo py-1.5 text-center text-sm text-white/85"
              >
                Other ways to sign in
              </button>
            </form>
          )}

          {screen === 'choose' && (
            <div className="flex w-full flex-col gap-3">
              <button
                type="button"
                disabled={!supabase || busy}
                title={supabase ? undefined : 'Google sign-in isn’t set up on this deployment yet'}
                onClick={signInWithGoogle}
                className={`btn min-h-[3.25rem] gap-3 px-5 text-[15px] shadow-pop ${
                  supabase
                    ? 'bg-white text-ink hover:bg-white/90'
                    : 'cursor-not-allowed bg-white/70 text-ink/50'
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full ${supabase ? '' : 'opacity-60'}`}
                  style={{
                    background:
                      'conic-gradient(#EA4335 0 25%,#FBBC05 0 50%,#34A853 0 75%,#4285F4 0)',
                  }}
                  aria-hidden
                />
                Continue with Google
              </button>
              <button
                type="button"
                disabled={!supabase}
                title={supabase ? undefined : 'Email sign-in isn’t set up on this deployment yet'}
                onClick={() => {
                  setError(null)
                  setMode('signin')
                  setScreen('email')
                }}
                className={`btn min-h-[3.25rem] border-[1.5px] text-[15px] backdrop-blur-[2px] ${
                  supabase
                    ? 'border-white/60 bg-white/5 text-white hover:bg-white/15'
                    : 'cursor-not-allowed border-white/25 bg-transparent text-white/50'
                }`}
              >
                Continue with email
              </button>

              {error && (
                <p className="on-photo mt-1 text-center text-sm font-semibold text-white">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* This used to make the same promise with nothing behind it — no
            terms existed and nothing recorded an agreement. The documents are
            real now, and agreeing is an explicit step after sign-in
            (components/TermsGate.tsx), so this is a signpost rather than a
            claim that continuing binds you to something unread. */}
        <p className="on-photo mt-6 text-center text-[11px] leading-relaxed text-white/75">
          <Link className="underline" to="/terms">
            Terms of use
          </Link>{' '}
          ·{' '}
          <Link className="underline" to="/privacy">
            Privacy
          </Link>
        </p>
      </div>
    </div>
  )
}
