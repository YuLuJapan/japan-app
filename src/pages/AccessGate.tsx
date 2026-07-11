import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setAccessCode } from '../api/client'

export default function AccessGate() {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      setAccessCode(code.trim())
      await api.post('/auth/verify', { code: code.trim() })
      navigate('/', { replace: true })
    } catch {
      localStorage.removeItem('trip_access_code')
      setError('Wrong code — try again.')
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
        <h1 className="mt-6 font-display text-4xl font-extrabold tracking-tight text-white">Japan</h1>
        <p className="mt-2 text-white/85">Yuval &amp; Luz · our trip companion</p>

        <form onSubmit={submit} className="mt-10 flex w-full flex-col gap-3 text-left">
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
            {busy ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  )
}
