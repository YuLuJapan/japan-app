// Invitations waiting for you, on the trips list.
//
// This is what makes the invite email optional: an invitation addressed to
// your address is here when you next sign in, whether or not anyone ever sent
// you the link. Renders nothing at all when there is nothing waiting.
import { useMyInvitations } from '../api/hooks'
import { useAcceptInvitation, useDeclineInvitation } from '../api/mutations'
import type { InvitePreview } from '../api/types'

const ROLE_BLURB = {
  partner: 'You’ll be able to add and change things.',
  viewer: 'You’ll be able to look, not change.',
} as const

/** What a viewer would actually see, in the trip's own words. */
function shownList(invite: InvitePreview): string | null {
  if (invite.role !== 'viewer') return null
  const on = [
    invite.shows.stays && 'where they’re staying',
    invite.shows.flight && 'flights',
    invite.shows.documents && 'documents',
  ].filter(Boolean) as string[]
  if (!on.length) return 'The bookings and documents stay private.'
  return `You’ll also see ${on.length === 1 ? on[0] : `${on.slice(0, -1).join(', ')} and ${on.at(-1)}`}.`
}

function Invitation({ invite }: { invite: InvitePreview }) {
  const accept = useAcceptInvitation()
  const decline = useDeclineInvitation()
  const busy = accept.isPending || decline.isPending
  // Only ever absent on a link preview, which this component never renders.
  const id = invite.id ?? ''
  const shows = shownList(invite)

  return (
    <article className="card p-4">
      <p className="font-display text-lg font-bold tracking-tight">
        {invite.invited_by ?? 'Someone'} invited you to {invite.trip_name}
      </p>
      <p className="mt-1 text-xs text-muted">
        {ROLE_BLURB[invite.role]}
        {shows ? ` ${shows}` : ''}
      </p>
      {accept.isError && (
        <p className="mt-2 text-xs font-semibold text-brand">
          That didn’t work — the invitation may have been withdrawn.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className="btn flex-1 bg-ink text-white"
          disabled={busy}
          onClick={() => accept.mutate(id)}
        >
          {accept.isPending ? 'Joining…' : 'Accept'}
        </button>
        <button
          type="button"
          className="chip bg-canvas font-semibold text-muted"
          disabled={busy}
          onClick={() => decline.mutate(id)}
        >
          No thanks
        </button>
      </div>
    </article>
  )
}

export function InvitationInbox() {
  const { data } = useMyInvitations()

  // A confirmation nudge, but only for someone who actually has something
  // waiting behind it — otherwise it is a scold with no purpose.
  if (data?.email_unconfirmed) {
    return (
      <section className="mt-7">
        <p className="rounded-2xl bg-canvas px-3.5 py-2.5 text-xs leading-5 text-muted">
          <strong className="text-ink">Confirm your email address</strong> — check your inbox for
          the link. Invitations sent to you are waiting until you do.
        </p>
      </section>
    )
  }

  const invitations = data?.invitations ?? []
  if (!invitations.length) return null

  return (
    <section className="mt-7">
      <p className="section-title">
        {invitations.length === 1 ? 'An invitation' : `${invitations.length} invitations`}
      </p>
      <div className="mt-3 flex flex-col gap-3.5">
        {invitations.map((invite) => (
          <Invitation key={invite.id} invite={invite} />
        ))}
      </div>
    </section>
  )
}
