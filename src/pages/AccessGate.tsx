import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, clearAccessCode, setAccessCode } from '../api/client'
import { RingMark } from '../components/RingMark'
import { capture } from '../lib/posthog'
import { getSupabaseClient } from '../lib/supabaseClient'

type Screen = 'choose' | 'email' | 'sent'
type Mode = 'signin' | 'signup'

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
  const [screen, setScreen] = useState<Screen>('choose')
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
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return
      completeSignIn(data.session.access_token, navigate).catch(() => {
        if (cancelled) return
        clearAccessCode()
        supabase.auth.signOut()
        setError('Signed in, but this app didn’t accept the session. Try again.')
        setScreen('choose')
      })
    })
    return () => {
      cancelled = true
    }
  }, [supabase, navigate])

  async function signInWithGoogle() {
    if (!supabase || busy) return
    setBusy(true)
    setError(null)
    // Redirects away; the useEffect above finishes the job on the way back.
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/gate` },
    })
    if (oauthError) {
      setError('Could not reach Google — try again.')
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

        <p className="mt-6 text-center text-[11px] leading-relaxed text-white/70">
          By continuing you agree to the terms and privacy policy.
        </p>
      </div>
    </div>
  )
}
