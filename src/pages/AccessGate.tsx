import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, clearAccessCode, setAccessCode, setStoredRole, type Role } from '../api/client'
import { getSupabaseClient } from '../lib/supabaseClient'

type Screen = 'choose' | 'email' | 'sent'

/** Shared with session.tsx's onAuthStateChange sync — resolves the role for
 * whatever bearer token is stored (shared code or a Supabase JWT) the same
 * way, and lands on /trips only once the server has actually accepted it. */
async function completeSignIn(token: string, navigate: (path: string, opts?: object) => void) {
  setAccessCode(token)
  const { role } = await api.post<{ ok: true; role: Role }>('/auth/verify', { code: token })
  setStoredRole(role === 'owner' ? 'owner' : 'guest')
  navigate('/trips', { replace: true })
}

export default function AccessGate() {
  const [screen, setScreen] = useState<Screen>('choose')
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const supabase = getSupabaseClient()

  // Landing back here after tapping the magic link: Supabase has already
  // parsed the session out of the URL by the time this runs.
  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return
      completeSignIn(data.session.access_token, navigate).catch(() => {
        if (cancelled) return
        clearAccessCode()
        supabase.auth.signOut()
        setError('That email isn’t set up for owner access — try an access code instead.')
        setScreen('choose')
      })
    })
    return () => {
      cancelled = true
    }
  }, [supabase, navigate])

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await completeSignIn(code.trim(), navigate)
    } catch {
      clearAccessCode()
      setError('Wrong code — try again.')
    } finally {
      setBusy(false)
    }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
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
      setError('Could not send the link — try again, or use an access code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-sun via-brand to-brand-700 px-6">
      <div className="absolute -left-16 top-10 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
      <div className="absolute -right-10 bottom-24 h-64 w-64 rounded-full bg-black/10 blur-2xl" />
      <div className="relative w-full max-w-app text-center">
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-white/95 text-4xl font-extrabold text-brand shadow-pop">
          旅
        </span>
        <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight text-white">
          Japan
        </h1>
        <p className="mt-2 text-white/85">Yuval &amp; Luciana · our trip companion</p>

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
          <form onSubmit={sendMagicLink} className="mt-10 flex w-full flex-col gap-3 text-left">
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
            {error && <p className="text-center text-sm font-semibold text-white">{error}</p>}
            <button
              type="submit"
              className="btn min-h-12 bg-ink text-white shadow-pop hover:bg-ink/90"
              disabled={busy}
            >
              {busy ? 'Sending…' : 'Continue'}
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
              disabled
              title="Coming soon — needs Google sign-in set up"
              className="btn min-h-12 cursor-not-allowed justify-start gap-3 bg-white/70 px-5 text-ink/50 shadow-pop"
            >
              <span
                className="h-5 w-5 rounded-full opacity-60"
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
              title={supabase ? undefined : 'Email sign-in isn’t set up yet — use an access code'}
              onClick={() => {
                setError(null)
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

            <div className="my-1 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-white/60">
              <span className="h-px flex-1 bg-white/25" />
              or
              <span className="h-px flex-1 bg-white/25" />
            </div>

            <form onSubmit={submitCode} className="flex flex-col gap-3 text-left">
              <input
                id="code"
                className="field border-transparent text-center text-lg tracking-widest shadow-pop"
                type="password"
                inputMode="text"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Access code"
                aria-label="Access code"
              />
              {error && <p className="text-center text-sm font-semibold text-white">{error}</p>}
              <button
                type="submit"
                className="btn min-h-12 bg-white text-brand shadow-pop hover:bg-white/90"
                disabled={busy}
              >
                {busy ? 'Checking…' : 'Enter with access code'}
              </button>
            </form>
          </div>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-white/70">
          By continuing you agree to the terms and privacy policy.
        </p>
      </div>
    </div>
  )
}
