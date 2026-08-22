// Who this trip is shared with: the roster, and the invitations out.
//
// The controls that decide what an invitation grants live in AccessPicker —
// they are asked here and in the trip sheet's traveller list, and two copies
// of the visibility rules would drift.
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTrip, useTripInvites, useTripMembers } from '../api/hooks'
import {
  useCreateInvite,
  useRemoveMember,
  useRevokeInvite,
  useUpdateMember,
} from '../api/mutations'
import type { TripMember, TripRole } from '../api/types'
import {
  AccessPicker,
  DEFAULT_SHOWS,
  ROLE_LABEL,
  SHOWS,
  Toggle,
  type InviteRole,
  type Shows,
} from '../components/AccessPicker'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'

export default function TripMembers() {
  const { tripId = '' } = useParams<{ tripId: string }>()
  const trip = useTrip(tripId)
  const members = useTripMembers(tripId)
  const invites = useTripInvites(tripId)
  const createInvite = useCreateInvite(tripId)
  const revokeInvite = useRevokeInvite(tripId)
  const updateMember = useUpdateMember(tripId)
  const removeMember = useRemoveMember(tripId)

  const [role, setRole] = useState<InviteRole>('viewer')
  const [email, setEmail] = useState('')
  const [shows, setShows] = useState<Shows>(DEFAULT_SHOWS)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState<TripMember | null>(null)

  const myRole = trip.data?.my_role ?? null
  const isOwner = myRole === 'owner'
  const canInvite = isOwner || myRole === 'partner'

  if (members.isLoading || trip.isLoading) return <Loading />
  if (members.isError) return <ErrorState onRetry={() => void members.refetch()} />

  async function invite() {
    const res = await createInvite.mutateAsync({
      role,
      ...(email.trim() ? { email: email.trim() } : {}),
      ...shows,
    })
    setLink(`${window.location.origin}/invite/${res.token}`)
    setCopied(false)
    setEmail('')
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">Who’s on this trip</h1>
        <p className="mt-1 text-sm text-muted">
          Add their email and the invitation is waiting when they next sign in — no link to send.
          Leave it blank and you get a link to share instead.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        {members.data?.members.map((m) => (
          <article key={m.user_id} className="rounded-2xl border border-line bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{m.display_name ?? m.email}</p>
                <p className="truncate text-xs text-muted">{m.email}</p>
              </div>
              {isOwner ? (
                <select
                  aria-label={`Access for ${m.display_name ?? m.email}`}
                  className="field w-auto py-1 text-sm"
                  value={m.role}
                  onChange={(e) => updateMember.mutate({ userId: m.user_id, role: e.target.value })}
                >
                  {(['owner', 'partner', 'viewer'] as TripRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rounded-full bg-canvas px-3 py-1 text-xs font-semibold text-muted">
                  {ROLE_LABEL[m.role]}
                </span>
              )}
            </div>

            {isOwner && m.role === 'viewer' && (
              <div className="mt-3 border-t border-line pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  They can see
                </p>
                {SHOWS.map((s) => (
                  <Toggle
                    key={s.key}
                    label={s.label}
                    hint={s.hint}
                    checked={m[s.key]}
                    onChange={(v) => updateMember.mutate({ userId: m.user_id, [s.key]: v })}
                  />
                ))}
              </div>
            )}

            {isOwner && (
              <button
                type="button"
                onClick={() => setConfirming(m)}
                className="mt-2 text-sm font-semibold text-brand"
              >
                Remove
              </button>
            )}
          </article>
        ))}
      </section>

      {canInvite && (
        <section className="rounded-2xl border border-line bg-white p-4">
          <h2 className="font-display text-lg font-semibold text-ink">Invite someone</h2>

          <div className="mt-3">
            <AccessPicker
              actorRole={myRole}
              role={role}
              onRole={setRole}
              shows={shows}
              onShows={setShows}
              idPrefix="invite"
            />
          </div>

          <input
            type="email"
            inputMode="email"
            className="field mt-3"
            placeholder="Their email (optional)"
            aria-label="Their email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <button
            type="button"
            className="btn mt-3 w-full bg-ink text-white"
            disabled={createInvite.isPending}
            onClick={invite}
          >
            {createInvite.isPending ? 'Creating…' : 'Create invite link'}
          </button>

          {link && (
            <div className="mt-3 rounded-xl bg-canvas p-3">
              <p className="text-xs font-semibold text-muted">
                Copy this now — it’s only shown once.
              </p>
              <p className="mt-1 break-all font-mono text-xs text-ink">{link}</p>
              <button
                type="button"
                className="btn mt-2 w-full bg-brand text-white"
                onClick={() => {
                  navigator.clipboard?.writeText(link)
                  setCopied(true)
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          )}
        </section>
      )}

      {canInvite && !!invites.data?.invites.length && (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-semibold text-ink">Invitations</h2>
          {invites.data.invites.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {i.email ?? 'Anyone with the link'}
                </p>
                <p className="text-xs text-muted">
                  {ROLE_LABEL[i.role]}
                  {/* Declined and revoked are different facts, and the person
                      who sent it deserves to know which one happened rather
                      than watching the row disappear. */}
                  {i.declined_at ? ' · declined' : ''}
                </p>
              </div>
              {!i.declined_at && (
                <button
                  type="button"
                  className="text-sm font-semibold text-brand"
                  onClick={() => revokeInvite.mutate(i.id)}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <ConfirmDialog
        open={!!confirming}
        title={`Remove ${confirming?.display_name ?? confirming?.email}?`}
        message="They’ll lose access to this trip. You can invite them again later."
        confirmLabel="Remove"
        onConfirm={() => {
          if (confirming) removeMember.mutate(confirming.user_id)
          setConfirming(null)
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
