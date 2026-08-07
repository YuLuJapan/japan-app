// Sign out and go back to the gate — the way to swap the code this phone is
// holding, e.g. leaving the read-only guest view for the travelers' code.
//
// Clears the stored code *and* the query cache, so the next code in doesn't
// briefly render the previous one's data (a guest's file-less zone payload,
// for instance) before the refetch lands.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { clearAccessCode } from '../api/client'
import { useCanEdit } from '../lib/session'
import { ConfirmDialog } from './ConfirmDialog'

export function SignOutButton() {
  const canEdit = useCanEdit()
  const [confirming, setConfirming] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const signOut = () => {
    clearAccessCode()
    queryClient.clear()
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
        message={
          canEdit
            ? 'You’ll need the access code to get back in.'
            : 'Enter the travelers’ code next to be able to edit, or the guest code to come back to this view.'
        }
        confirmLabel="Sign out"
        onConfirm={signOut}
        onCancel={() => setConfirming(false)}
      />
    </>
  )
}
