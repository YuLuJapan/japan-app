// What an invitation grants: two independent axes, deliberately two controls.
//
// The **role** decides which verbs someone gets; the **toggles** decide
// which content a viewer is shown. Writers ignore the toggles entirely — the
// server ignores them too, rather than validating them, so an owner can never
// lock themselves out of their own bookings — which is why they are only
// offered for a viewer.
//
// This lives here rather than in the members screen because it is now asked in
// two places: that screen, and the traveller roster in the trip sheet. Two
// copies of these rules would drift, and visibility rules that drift are a
// security-shaped bug rather than a cosmetic one.
import type { TripRole } from '../api/types'

export const ROLE_LABEL: Record<TripRole, string> = {
  owner: 'Owner',
  partner: 'Partner',
  viewer: 'View only',
}

const ROLE_BLURB: Record<TripRole, string> = {
  owner: 'Can edit everything, and manage who else is here.',
  partner: 'Can edit everything. Can invite viewers.',
  viewer: 'Can look, not change.',
}

/** The two roles an invitation may grant. `owner` is ungrantable by schema. */
export type InviteRole = 'partner' | 'viewer'

export type Shows = {
  can_see_stays: boolean
  can_see_flight: boolean
  can_see_documents: boolean
  can_see_shopping: boolean
}

/** A document is a file nobody can audit at a glance, so it is off by default. */
export const DEFAULT_SHOWS: Shows = {
  can_see_stays: true,
  can_see_flight: true,
  can_see_shopping: true,
  can_see_documents: false,
}

export const SHOWS: { key: keyof Shows; label: string; hint: string }[] = [
  { key: 'can_see_stays', label: 'Where we’re staying', hint: 'Hotels, and what they cost' },
  { key: 'can_see_flight', label: 'Flights', hint: 'Times and booking reference' },
  // Off means the Shopping tab isn't there at all — which is the point when
  // what's on the list is a present for the person you're sharing with.
  { key: 'can_see_shopping', label: 'Shopping list', hint: 'What we want to buy, and presents' },
  // Last, so the caveat below sits next to the toggle it is about.
  { key: 'can_see_documents', label: 'Documents', hint: 'Everything in the Docs tab' },
]

export function Toggle({
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

/**
 * Pick a role, and — for a viewer — what they will see.
 *
 * `actorRole` narrows the choice rather than the caller doing it: a partner may
 * invite viewers only, which is what stops write access spreading sideways with
 * no owner in the loop. The server enforces the same rule; this keeps the UI
 * from offering a button that would be refused.
 */
export function AccessPicker({
  actorRole,
  role,
  onRole,
  shows,
  onShows,
  idPrefix,
}: {
  actorRole: TripRole | null
  role: InviteRole
  onRole: (r: InviteRole) => void
  shows: Shows
  onShows: (s: Shows) => void
  /** Radios need a unique group name when two pickers share a page. */
  idPrefix: string
}) {
  const choices: InviteRole[] = actorRole === 'owner' ? ['partner', 'viewer'] : ['viewer']

  return (
    <>
      <div className="flex flex-col gap-2">
        {choices.map((r) => (
          <label key={r} className="flex items-start gap-3">
            <input
              type="radio"
              name={`${idPrefix}-role`}
              className="mt-1 h-4 w-4 accent-brand"
              checked={role === r}
              onChange={() => onRole(r)}
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
              onChange={(v) => onShows({ ...shows, [s.key]: v })}
            />
          ))}
          {/* Stated plainly rather than papered over: a document attached to
              the trip is a file with a name, and the app cannot know what is
              inside it. Only files attached to a hotel follow the stays. */}
          <p className="mt-1 text-xs text-muted">
            Documents are shown as they are — a file you attached to the trip isn’t filtered by the
            others.
          </p>
        </div>
      )}
    </>
  )
}
