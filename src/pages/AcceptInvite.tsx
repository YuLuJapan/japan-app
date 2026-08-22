// Opening an invite link.
//
// The token is the authorization — whoever holds it may see the preview and,
// once signed in, accept. The preview is deliberately thin (trip name, who
// asked, what you'd get): an unaccepted invitation is not access, so it shows
// no trip content.
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useInvitePreview } from '../api/hooks'
import { useAcceptInvite } from '../api/mutations'
import { getAccessCode } from '../api/client'
import { Loading } from '../components/Loading'
import { RingMark } from '../components/RingMark'

const ROLE_LABEL: Record<string, string> = {
  partner: 'edit everything',
  viewer: 'look, not change',
}

export default function AcceptInvite() {
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const signedIn = !!getAccessCode()
  const preview = useInvitePreview(token)
  const accept = useAcceptInvite()

  // Signing in bounces back here, so remember which link we were opening.
  useEffect(() => {
    if (!signedIn) sessionStorage.setItem('pending_invite', token)
  }, [signedIn, token])

  if (!signedIn) {
    return (
      <Shell>
        <p className="text-white/85">Sign in to join this trip.</p>
        <button
          type="button"
          className="btn mt-4 w-full bg-white text-brand"
          onClick={() => navigate('/gate')}
        >
          Sign in
        </button>
      </Shell>
    )
  }

  if (preview.isLoading) return <Loading />

  if (preview.isError) {
    return (
      <Shell>
        <p className="font-semibold text-white">This invitation is no longer valid.</p>
        <p className="mt-1 text-sm text-white/80">
          It may have been used, revoked, or simply expired. Ask for a fresh link.
        </p>
        <button
          type="button"
          className="btn mt-4 w-full bg-white text-brand"
          onClick={() => navigate('/trips')}
        >
          Go to my trips
        </button>
      </Shell>
    )
  }

  const invite = preview.data!.invite
  const shows = [
    invite.shows.stays && 'where you’re staying',
    invite.shows.flight && 'the flights',
    invite.shows.documents && 'the documents',
  ].filter(Boolean) as string[]

  return (
    <Shell>
      <p className="text-white/85">
        {invite.invited_by ? `${invite.invited_by} invited you to` : 'You’ve been invited to'}
      </p>
      <h2 className="mt-1 font-display text-2xl font-extrabold text-white">{invite.trip_name}</h2>
      <p className="mt-3 text-sm text-white/85">
        You’ll be able to {ROLE_LABEL[invite.role] ?? 'look around'}
        {shows.length ? `, and see ${shows.join(', ')}` : ''}.
      </p>

      {accept.isError && (
        <p className="mt-3 text-sm font-semibold text-white">
          That didn’t work — the link may be for a different email address.
        </p>
      )}

      <button
        type="button"
        className="btn mt-5 w-full bg-white text-brand"
        disabled={accept.isPending}
        onClick={() =>
          accept.mutate(token, {
            onSuccess: (res) => {
              sessionStorage.removeItem('pending_invite')
              navigate(`/trips/${res.trip_id}`, { replace: true })
            },
          })
        }
      >
        {accept.isPending ? 'Joining…' : 'Join this trip'}
      </button>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
      style={{ background: 'linear-gradient(150deg,#F9873F 0%,#F1543F 55%,#E3402F 100%)' }}
    >
      <div className="w-full max-w-app">
        <div className="mx-auto w-fit">
          <RingMark size={72} />
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
