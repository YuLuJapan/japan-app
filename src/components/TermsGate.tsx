// "You have to agree before you can use this."
//
// Deliberately after sign-in rather than as a tick-box on the sign-up form.
// Two of the three ways into this app — Google and the magic link — leave the
// page entirely and come back, so a checkbox on the password form would cover
// one path out of three. Sitting here, behind the session, it covers every way
// in with one piece of code, and covers the accounts that existed before the
// terms did.
//
// It is also what makes a version bump work: change the documents, bump
// CURRENT_TERMS_VERSION, and everyone is asked again on their next visit.
import { Link } from 'react-router-dom'
import { useMe } from '../api/hooks'
import { useAcceptTerms } from '../api/mutations'
import { Loading } from './Loading'

export function TermsGate({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const accept = useAcceptTerms()

  if (me.isPending) return <Loading label="Signing you in…" />
  // A failed /me is not the moment to demand agreement — the app has bigger
  // problems, and the screens below explain them better than this can.
  if (me.isError || me.data?.terms.accepted) return <>{children}</>

  return (
    <div className="mx-auto flex min-h-screen max-w-app flex-col justify-center px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Before you start</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Please read the{' '}
        <Link className="font-semibold text-brand underline" to="/terms">
          terms of use
        </Link>{' '}
        and the{' '}
        <Link className="font-semibold text-brand underline" to="/privacy">
          privacy policy
        </Link>
        .
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        The short version: this is a personal project offered free and as-is. Everything in a trip
        is what you typed — nothing is checked against an airline or a hotel, so confirm real travel
        details with them. Keep your own copy of anything you cannot afford to lose.
      </p>

      {accept.isError && (
        <p className="mt-4 text-sm font-medium text-brand">
          That didn&rsquo;t save — check your connection and try again.
        </p>
      )}

      <button
        type="button"
        className="btn-primary mt-6"
        disabled={accept.isPending}
        onClick={() => accept.mutate()}
      >
        {accept.isPending ? 'Saving…' : 'I agree — continue'}
      </button>
    </div>
  )
}
