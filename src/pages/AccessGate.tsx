import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { api, clearAccessCode, getAccessCode, setAccessCode } from '../api/client'
import { RingMark } from '../components/RingMark'
import { readLoginArrival, type LoginArrival, type LoginLink } from '../lib/login-arrival'
import { capture } from '../lib/posthog'
import { getSupabaseClient } from '../lib/supabaseClient'

type Screen = 'choose' | 'email' | 'sent' | 'resolving'
type Mode = 'signin' | 'signup'

/**
 * Is a sign-in already in flight as this screen mounts?
 *
 * Google and every emailed link leave the page and come back to /gate with the
 * session in the URL (lib/login-arrival.ts reads which). Reading the URL takes
 * supabase-js a moment and proving the token against /me takes a round trip,
 * and for that second or two this screen used to render its full set of
 * sign-in buttons: someone who had just authenticated with Google was shown
 * "Continue with Google" again, as if it had not worked, and then bounced to
 * the trips list mid-tap.
 *
 * A stored token counts too — it means the last session is being restored
 * rather than started, which ends in the same navigation.
 */
function resumingSignIn(arrival: LoginArrival): boolean {
  return arrival.redirect || !!getAccessCode()
}

/** What proved this caller, as far as the URL and the session are willing to say. */
interface SignInFacts {
  /** 'password' | 'magic_link' | 'email_link' | the provider of an OAuth session. */
  method: string
  /** The emailed link that carried it, so the click can be counted as one. */
  link: LoginLink | null
}

/**
 * Which credential a redirect arrived on.
 *
 * The URL is asked first and the session second: `app_metadata.provider` says
 * 'email' for a magic link, a confirmation link and a password alike, so it
 * can name Google and nothing finer.
 */
function redirectMethod(arrival: LoginArrival, session: Session): string {
  if (arrival.link) return arrival.link === 'magic_link' ? 'magic_link' : 'email_link'
  return session.user?.app_metadata?.provider ?? 'unknown'
}

/**
 * Store the token, then prove the API accepts it before navigating.
 *
 * Supabase saying yes and this app saying yes are two different things — the
 * project could be misconfigured, or the API unreachable — and landing on a
 * trips list that immediately bounces back here is a worse first second than
 * an error on the gate.
 *
 * It is also where the sign-in is *reported*, because this is the one place
 * that knows a sign-in just happened and that both sides said yes. The auth
 * listener cannot: supabase-js emits `SIGNED_IN` for a session merely restored
 * from storage, on every load and every return to the tab (see lib/session.tsx).
 * `signIn` is null when nothing was proved — arriving at /gate with a live
 * session is a restore, not a sign-in.
 */
async function completeSignIn(
  token: string,
  navigate: (path: string, opts?: object) => void,
  signIn: SignInFacts | null
) {
  setAccessCode(token)
  await api.get<{ user: { id: string } }>('/me')
  if (signIn) {
    capture('user_signed_in', { method: signIn.method })
    if (signIn.link) capture('login_link_opened', { link_type: signIn.link, outcome: 'signed_in' })
  }
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
  // Both resolved once, at mount, and in this order: the URL still carries the
  // redirect's payload here, and supabase-js strips it the moment the client is
  // created — which is what `getSupabaseClient()` on the next line does.
  const [arrival] = useState(readLoginArrival)
  const [screen, setScreen] = useState<Screen>(() =>
    getSupabaseClient() && resumingSignIn(arrival) ? 'resolving' : 'choose'
  )
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const supabase = getSupabaseClient()

  // Landing back here after tapping an emailed link or returning from Google:
  // Supabase has already parsed the session out of the URL by the time this runs.
  //
  // Each of the three ways this can end reports the tapped link, and every one
  // of those captures goes *before* the mount check: the link was opened
  // whether or not this screen is still on the page a moment later.
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    const linkFailed = (outcome: 'no_session' | 'refused') => {
      if (!arrival.link) return
      capture('login_link_opened', {
        link_type: arrival.link,
        outcome,
        error_code: arrival.errorCode ?? undefined,
      })
    }
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!data.session) {
          // Nothing came back — a cancelled Google prompt, a link that had
          // already been used or expired. Whatever the guess at mount was,
          // there is nobody to sign in, so offer the ways in again.
          linkFailed('no_session')
          if (cancelled) return
          setScreen((current) => (current === 'resolving' ? 'choose' : current))
          return
        }
        if (cancelled) return
        return completeSignIn(
          data.session.access_token,
          navigate,
          arrival.redirect
            ? { method: redirectMethod(arrival, data.session), link: arrival.link }
            : null
        ).catch(() => {
          linkFailed('refused')
          if (cancelled) return
          clearAccessCode()
          supabase.auth.signOut()
          setError('Signed in, but this app didn’t accept the session. Try again.')
          setScreen('choose')
        })
      })
      .catch(() => {
        linkFailed('refused')
        if (cancelled) return
        setError('Could not check your sign-in — try again.')
        setScreen('choose')
      })
    return () => {
      cancelled = true
    }
  }, [supabase, navigate, arrival])

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
      // exists but cannot be used until the link is tapped. That link is one of
      // the emailed ways in, so it is counted as one.
      if (!data.session) {
        if (mode === 'signup') capture('login_link_sent', { link_type: 'signup' })
        setScreen('sent')
        return
      }
      // Two events, not one: this is the only place that knows the account was
      // just *created* rather than merely opened, and the sign-in that follows
      // is reported by `completeSignIn` along with every other way in.
      if (mode === 'signup') capture('user_signed_up', { method: 'password' })
      await completeSignIn(data.session.access_token, navigate, {
        method: 'password',
        link: null,
      })
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
      capture('login_link_sent', { link_type: 'magic_link' })
      setScreen('sent')
    } catch {
      setError('Could not send the link — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6"
      style={{
        background: 'linear-gradient(150deg,#F9873F 0%,#F1543F 55%,#E3402F 100%)',
      }}
    >
      <div className="absolute -left-16 top-10 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
      <div className="absolute -right-10 bottom-24 h-64 w-64 rounded-full bg-black/10 blur-2xl" />
      <div className="relative w-full max-w-app text-center">
        <div className="mx-auto w-fit">
          <RingMark size={88} />
        </div>
        <h1 className="mt-6 font-display text-4xl font-bold tracking-tight text-white">Onward</h1>
        <p className="mt-2 text-white/85">Your trip companion</p>

        {screen === 'resolving' && (
          <div className="mt-10 flex flex-col items-center gap-3" role="status">
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/35 border-t-white" />
            <p className="text-sm font-semibold text-white">Signing you in…</p>
          </div>
        )}

        {screen === 'sent' && (
          <div className="mt-10 flex flex-col gap-3 text-left">
            <p className="text-center text-sm font-semibold text-white">
              Check your email — we sent a sign-in link to {email.trim()}.
            </p>
            <button
              type="button"
              onClick={() => setScreen('choose')}
              className="text-center text-sm text-white/85 underline underline-offset-2"
            >
              Use a different way in
            </button>
          </div>
        )}

        {screen === 'email' && (
          <form onSubmit={submitPassword} className="mt-10 flex w-full flex-col gap-3 text-left">
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
            {error && <p className="text-center text-sm font-semibold text-white">{error}</p>}
            <button
              type="submit"
              className="btn min-h-12 bg-ink text-white shadow-pop hover:bg-ink/90"
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
              className="py-1 text-center text-sm text-white/85 underline underline-offset-2"
            >
              {mode === 'signup' ? 'I already have an account' : 'Create an account'}
            </button>
            <button
              type="button"
              onClick={sendMagicLink}
              disabled={busy}
              className="py-1 text-center text-sm text-white/85 underline underline-offset-2"
            >
              Email me a sign-in link instead
            </button>
            <button
              type="button"
              onClick={() => setScreen('choose')}
              className="py-1.5 text-center text-sm text-white/85"
            >
              Other ways to sign in
            </button>
          </form>
        )}

        {screen === 'choose' && (
          <div className="mt-10 flex w-full flex-col gap-2.5">
            <button
              type="button"
              disabled={!supabase || busy}
              title={supabase ? undefined : 'Google sign-in isn’t set up on this deployment yet'}
              onClick={signInWithGoogle}
              className={`btn min-h-12 justify-start gap-3 px-5 shadow-pop ${
                supabase
                  ? 'bg-white text-ink hover:bg-white/90'
                  : 'cursor-not-allowed bg-white/70 text-ink/50'
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full ${supabase ? '' : 'opacity-60'}`}
                style={{
                  background: 'conic-gradient(#EA4335 0 25%,#FBBC05 0 50%,#34A853 0 75%,#4285F4 0)',
                }}
                aria-hidden
              />
              Continue with Google
            </button>
            <button
              type="button"
              disabled
              title="Coming soon — needs Apple sign-in set up"
              className="btn min-h-12 cursor-not-allowed justify-start gap-3 bg-ink/70 px-5 text-white/60"
            >
              <span className="h-4 w-4 rounded-full bg-white/60" aria-hidden />
              Continue with Apple ID
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
              className={`btn min-h-12 border-[1.5px] ${
                supabase
                  ? 'border-white/55 bg-transparent text-white hover:bg-white/10'
                  : 'cursor-not-allowed border-white/25 bg-transparent text-white/50'
              }`}
            >
              Continue with email
            </button>

            {error && <p className="mt-1 text-center text-sm font-semibold text-white">{error}</p>}
          </div>
        )}

        {/* This used to make the same promise with nothing behind it — no
            terms existed and nothing recorded an agreement. The documents are
            real now, and agreeing is an explicit step after sign-in
            (components/TermsGate.tsx), so this is a signpost rather than a
            claim that continuing binds you to something unread. */}
        <p className="mt-6 text-center text-[11px] leading-relaxed text-white/70">
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
