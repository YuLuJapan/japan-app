// Sign out and go back to the gate.
//
// Clears the stored token *and* the query cache, so the next account in
// doesn't briefly render the previous one's data (a viewer's file-less zone
// payload, for instance) before the refetch lands.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { clearAccessCode } from '../api/client'
import { capture, reset } from '../lib/posthog'
import { getSupabaseClient } from '../lib/supabaseClient'
import { ConfirmDialog } from './ConfirmDialog'

export function SignOutButton() {
  const [confirming, setConfirming] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const signOut = async () => {
    capture('user_signed_out')
    reset()
    clearAccessCode()
    queryClient.clear()
    // Await, and only then navigate. supabase.auth.signOut() clears its own
    // stored session asynchronously; navigating first lands on the gate while
    // that session is still in localStorage, and the gate's restore effect
    // reads it, calls completeSignIn() and sends you straight back to /trips —
    // signed "in" with a token whose refresh has just been revoked. The app
    // then looks signed in until the next request 401s.
    await getSupabaseClient()
      ?.auth.signOut()
      // A failed revoke must not strand someone on a screen they asked to
      // leave: the local session is already gone above either way.
      .catch(() => undefined)
    navigate('/gate', { replace: true })
  }

  return (
    <>
      <button
        type="button"
        aria-label="Sign out"
        onClick={() => setConfirming(true)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white text-ink active:scale-95"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5M21 12H9" />
        </svg>
      </button>

      <ConfirmDialog
        open={confirming}
        title="Sign out?"
        // Neutral about *how* you get back in: the session may be a Google
        // account, a password one or a magic link, and the button cannot tell
        // which without another round-trip.
        message="You’ll need to sign in again to get back in."
        confirmLabel="Sign out"
        onConfirm={signOut}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}
