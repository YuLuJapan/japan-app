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
import { Breadcrumbs } from '../components/Breadcrumbs'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { saveErrorMessage } from '../lib/errors'

/** Everything about one member an owner is allowed to change, in one patch. */
type MemberDraft = { role: TripRole } & Shows

function toDraft(m: TripMember): MemberDraft {
  return {
    role: m.role,
    can_see_stays: m.can_see_stays,
    can_see_flight: m.can_see_flight,
    can_see_documents: m.can_see_documents,
    can_see_shopping: m.can_see_shopping,
  }
}

const DRAFT_KEYS: (keyof MemberDraft)[] = [
  'role',
  'can_see_stays',
  'can_see_flight',
  'can_see_documents',
  'can_see_shopping',
]

/**
 * One person on the trip.
 *
 * The owner-only controls edit a *draft* and save on a button rather than
 * firing a request per keystroke. That is not only taste: the server refuses
 * some of these (demoting the last owner), and a change that saves itself has
 * nowhere to put the refusal — the control just sprang back with no
 * explanation. An explicit Save gives the failure somewhere to land, and the
 * visibility flags a way to move together in one request.
 */
function MemberCard({
  member,
  isOwner,
  onRemove,
  onSave,
}: {
  member: TripMember
  isOwner: boolean
  onRemove: () => void
  onSave: (draft: MemberDraft) => Promise<unknown>
}) {
  // What is on the server as far as this card knows: where it started, moving
  // forward only on a save that actually went through. Deliberately not
  // re-read from the roster on every refetch — a background refetch landing
  // mid-edit would otherwise wipe what you were in the middle of typing.
  const [baseline, setBaseline] = useState<MemberDraft>(() => toDraft(member))
  const [draft, setDraft] = useState<MemberDraft>(baseline)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const dirty = DRAFT_KEYS.some((k) => draft[k] !== baseline[k])

  function edit(patch: Partial<MemberDraft>) {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
    setJustSaved(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      setBaseline(draft)
      setJustSaved(true)
    } catch (err) {
      setError(saveErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const who = member.display_name ?? member.email

  return (
    <article className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{who}</p>
          <p className="truncate text-xs text-muted">{member.email}</p>
        </div>
        {isOwner ? (
          <select
            aria-label={`Access for ${who}`}
            className="field w-auto py-1 text-sm"
            value={draft.role}
            onChange={(e) => edit({ role: e.target.value as TripRole })}
          >
            {(['owner', 'partner', 'viewer'] as TripRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-full bg-canvas px-3 py-1 text-xs font-semibold text-muted">
            {ROLE_LABEL[member.role]}
          </span>
        )}
      </div>

      {isOwner && draft.role === 'viewer' && (
        <div className="mt-3 border-t border-line pt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">They can see</p>
          {SHOWS.map((s) => (
            <Toggle
              key={s.key}
              label={s.label}
              hint={s.hint}
              checked={draft[s.key]}
              onChange={(v) => edit({ [s.key]: v })}
            />
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-sm font-semibold text-brand">{error}</p>}

      {isOwner && (dirty || saving) && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            className="btn flex-1 bg-ink text-white"
            disabled={saving}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={saving}
            onClick={() => {
              setDraft(baseline)
              setError(null)
            }}
          >
            Discard
          </button>
        </div>
      )}

      {/* Only after a save that actually went through, and only until the next
          edit — a permanent "Saved" tells you nothing. */}
      {justSaved && <p className="mt-2 text-xs font-semibold text-muted">Saved.</p>}

      {isOwner && (
        <button type="button" onClick={onRemove} className="mt-2 text-sm font-semibold text-brand">
          Remove
        </button>
      )}
    </article>
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

  const [role, setRole] = useState<InviteRole>('viewer')
  const [email, setEmail] = useState('')
  const [shows, setShows] = useState<Shows>(DEFAULT_SHOWS)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<TripMember | null>(null)

  const myRole = trip.data?.my_role ?? null
  const isOwner = myRole === 'owner'
  const canInvite = isOwner || myRole === 'partner'

  // The way in is the Essentials tab, and the tab strip only leads back to the
  // top of a tab — without this the screen was a dead end.
  const crumbs = [{ label: 'Essentials', to: `/trips/${tripId}/essentials` }]

  if (members.isLoading || trip.isLoading) return <Loading />
  if (members.isError) return <ErrorState onRetry={() => void members.refetch()} />

  async function invite() {
    setInviteError(null)
    try {
      const res = await createInvite.mutateAsync({
        role,
        ...(email.trim() ? { email: email.trim() } : {}),
        ...shows,
      })
      setLink(`${window.location.origin}/invite/${res.token}`)
      setCopied(false)
      setEmail('')
    } catch (err) {
      setInviteError(saveErrorMessage(err, 'Could not create that invitation — try again.'))
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-24">
      <Breadcrumbs trail={crumbs} />

      <header>
        <h1 className="font-display text-2xl font-bold text-ink">Who’s on this trip</h1>
        <p className="mt-1 text-sm text-muted">
          Add their email and the invitation is waiting when they next sign in — no link to send.
          Leave it blank and you get a link to share instead.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        {members.data?.members.map((m) => (
          <MemberCard
            key={m.user_id}
            member={m}
            isOwner={isOwner}
            onRemove={() => setConfirming(m)}
            onSave={(draft) => updateMember.mutateAsync({ userId: m.user_id, ...draft })}
          />
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

          {inviteError && <p className="mt-2 text-sm font-semibold text-brand">{inviteError}</p>}

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
