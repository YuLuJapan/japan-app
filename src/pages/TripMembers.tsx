// Who this trip is shared with.
//
// Two independent axes, deliberately shown as two separate controls: the role
// decides which *verbs* someone gets, the three toggles decide which *content*
// a viewer is shown. Writers ignore the toggles entirely, so they are only
// offered for viewers.
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
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'

const ROLE_LABEL: Record<TripRole, string> = {
  owner: 'Owner',
  partner: 'Partner',
  viewer: 'View only',
}

const ROLE_BLURB: Record<TripRole, string> = {
  owner: 'Can edit everything, and manage who else is here.',
  partner: 'Can edit everything. Can invite viewers.',
  viewer: 'Can look, not change.',
}

type Shows = { can_see_stays: boolean; can_see_flight: boolean; can_see_documents: boolean }

const SHOWS: { key: keyof Shows; label: string; hint: string }[] = [
  { key: 'can_see_stays', label: 'Where we’re staying', hint: 'Hotels, and what they cost' },
  { key: 'can_see_flight', label: 'Flights', hint: 'Times and booking reference' },
  { key: 'can_see_documents', label: 'Documents', hint: 'Everything in the Docs tab' },
]

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
  disabled?: boolean
}) {
  return (
    <label className="flex items-start gap-3 py-2">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 accent-brand"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  )
}

export default function TripMembers() {
  const { tripId = '' } = useParams<{ tripId: string }>()
  const trip = useTrip(tripId)
  const members = useTripMembers(tripId)
  const invites = useTripInvites(tripId)
  const createInvite = useCreateInvite(tripId)
  const revokeInvite = useRevokeInvite(tripId)
  const updateMember = useUpdateMember(tripId)
  const removeMember = useRemoveMember(tripId)

  const [role, setRole] = useState<'partner' | 'viewer'>('viewer')
  const [email, setEmail] = useState('')
  const [shows, setShows] = useState<Shows>({
    can_see_stays: true,
    can_see_flight: true,
    can_see_documents: false,
  })
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
        <h1 className="font-display text-2xl font-extrabold text-ink">Who’s on this trip</h1>
        <p className="mt-1 text-sm text-muted">
          Share it with a link. Anyone who opens it and signs in joins with the access you chose.
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
          <h2 className="font-display text-lg font-bold text-ink">Invite someone</h2>

          <div className="mt-3 flex flex-col gap-2">
            {(isOwner ? (['partner', 'viewer'] as const) : (['viewer'] as const)).map((r) => (
              <label key={r} className="flex items-start gap-3">
                <input
                  type="radio"
                  name="role"
                  className="mt-1 h-4 w-4 accent-brand"
                  checked={role === r}
                  onChange={() => setRole(r)}
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">{ROLE_LABEL[r]}</span>
                  <span className="block text-xs text-muted">{ROLE_BLURB[r]}</span>
                </span>
              </label>
            ))}
          </div>

          {role === 'viewer' && (
            <div className="mt-3 border-t border-line pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                They’ll be able to see
              </p>
              {SHOWS.map((s) => (
                <Toggle
                  key={s.key}
                  label={s.label}
                  hint={s.hint}
                  checked={shows[s.key]}
                  onChange={(v) => setShows({ ...shows, [s.key]: v })}
                />
              ))}
              {/* Stated plainly rather than papered over: a document attached to
                  the trip is a file with a name, and the app cannot know what is
                  inside it. Only files attached to a hotel follow the stays. */}
              <p className="mt-1 text-xs text-muted">
                Documents are shown as they are — a file you attached to the trip isn’t filtered by
                the other two.
              </p>
            </div>
          )}

          <input
            type="email"
            inputMode="email"
            className="field mt-3"
            placeholder="Their email (optional — locks the link to them)"
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
          <h2 className="font-display text-lg font-bold text-ink">Waiting to be accepted</h2>
          {invites.data.invites.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {i.email ?? 'Anyone with the link'}
                </p>
                <p className="text-xs text-muted">{ROLE_LABEL[i.role]}</p>
              </div>
              <button
                type="button"
                className="text-sm font-semibold text-brand"
                onClick={() => revokeInvite.mutate(i.id)}
              >
                Revoke
              </button>
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
