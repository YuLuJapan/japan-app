// Sign out and go back to the gate.
//
// Clears the stored token *and* the query cache, so the next account in
// doesn't briefly render the previous one's data (a viewer's file-less zone
// payload, for instance) before the refetch lands.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { clearAccessCode } from '../api/client'
import { getSupabaseClient } from '../lib/supabaseClient'
import { ConfirmDialog } from './ConfirmDialog'

export function SignOutButton() {
  const [confirming, setConfirming] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const signOut = () => {
    clearAccessCode()
    queryClient.clear()
    getSupabaseClient()?.auth.signOut()
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
