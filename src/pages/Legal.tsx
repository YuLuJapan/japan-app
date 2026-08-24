// The terms and the privacy policy.
//
// Both live outside RequireAccess: someone deciding whether to sign up has to
// be able to read them first, and a link in an email must not bounce to the
// gate. They are plain React rather than fetched content — they change with a
// deploy, and the version people accepted is pinned by the git history of this
// file (see server/src/lib/terms.ts).
//
// Written to describe what this app actually does, which is the only kind of
// privacy policy worth having. If the app starts doing something else, this
// page changes and CURRENT_TERMS_VERSION is bumped so everyone is asked again.
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CONTACT_EMAIL, LAST_UPDATED, PUBLISHER } from '../lib/legal'

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  // Back means *back*, not "/gate". Sent to the gate, a signed-in reader got a
  // flash of the sign-in screen before its session check bounced them onward —
  // gate → completeSignIn → /trips → "Before you start" — which is a long way
  // round to return to the screen they left one tap earlier.
  //
  // `key === 'default'` is React Router's marker for the first entry in this
  // history stack: someone who opened /terms cold, from a link in an email,
  // has nothing to go back to and is sent to the gate instead.
  const canGoBack = location.key !== 'default'

  return (
    <div className="mx-auto min-h-screen max-w-app px-5 py-8">
      <button
        type="button"
        className="text-sm font-bold text-brand"
        onClick={() => (canGoBack ? navigate(-1) : navigate('/gate', { replace: true }))}
      >
        ← Back
      </button>
      <h1 className="mt-4 font-display text-3xl font-bold text-ink">{title}</h1>
      <p className="mt-1 text-xs text-muted">Last updated {LAST_UPDATED}</p>
      <div className="mt-6 space-y-5 text-sm leading-relaxed text-ink">{children}</div>
      <p className="mt-8 border-t border-line pt-4 text-xs text-muted">
        Questions? Write to{' '}
        <a className="font-semibold text-brand" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </div>
  )
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-display text-lg font-bold text-ink">{children}</h2>
)

export function Terms() {
  return (
    <Page title="Terms of use">
      <p>
        This app is a trip planner published by {PUBLISHER}. It is offered free of charge and as a
        personal project. Using it means accepting what is written here.
      </p>

      <H>What this app is not</H>
      <p>
        <strong>
          It is a notebook, not a source of truth. Everything you see in a trip was typed in by you
          or by someone you share it with — including flight numbers, times and addresses.
        </strong>{' '}
        Nothing is checked against an airline, a hotel or any booking system, and we do not import
        or verify any of it. Always confirm travel details with the airline, the operator or your
        own booking. Do not rely on this app to catch a flight.
      </p>

      <H>Your account</H>
      <p>
        You need an account, and you are responsible for what happens under it — including keeping
        your password and your email account secure. Use a real address you control: it is how
        invitations reach you and how we would contact you.
      </p>
      <p>
        You must be old enough to agree to this in your country, and you must not use the app to
        break the law, to store someone else&rsquo;s data without their knowledge, or to upload
        anything you do not have the right to share.
      </p>

      <H>Your content stays yours</H>
      <p>
        Trips, notes, photos and documents you add remain yours. You give us permission to store and
        display them only so the app can work — showing them back to you, and to the people you
        invite. We do not sell them, and we do not use them to train anything.
      </p>

      <H>Sharing a trip</H>
      <p>
        When you invite someone, you choose what they can see. Once shared, they can read that
        content, and someone you invite as a partner can change it. Removing them stops future
        access — it cannot undo what they already read or copied. Invite people you trust.
      </p>

      <H>No warranty, and limits</H>
      <p>
        The app is provided &ldquo;as is&rdquo;, with no guarantee that it will be available,
        correct, or free of bugs. It runs on free hosting tiers and may be slow, interrupted, or
        discontinued. To the fullest extent the law allows, {PUBLISHER} are not liable for any loss
        arising from using it — including missed travel, lost bookings or lost data.
      </p>
      <p>
        <strong>Keep your own copy of anything you cannot afford to lose.</strong> A document that
        exists only in this app is a document with one copy.
      </p>

      <H>Ending it</H>
      <p>
        You can stop using the app at any time and ask us to delete your account (see the{' '}
        <Link className="font-semibold text-brand" to="/privacy">
          privacy policy
        </Link>
        ). We may suspend or remove an account that is being used abusively, or shut the service
        down entirely — we will try to give notice by email if that happens.
      </p>

      <H>Changes</H>
      <p>
        If these terms change in a way that matters, you will be asked to accept the new version the
        next time you open the app.
      </p>
    </Page>
  )
}

export function Privacy() {
  return (
    <Page title="Privacy">
      <p>
        {PUBLISHER} are responsible for the personal data this app holds. This page says what is
        stored, where, and what you can do about it. It describes the app as it actually behaves.
      </p>

      <H>What is stored</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Your account</strong> — email address, and the display name and picture from
          Google if you sign in that way.
        </li>
        <li>
          <strong>Your trips</strong> — dates, destinations, places, notes, itineraries, shopping
          lists, and flight details you enter.
        </li>
        <li>
          <strong>Files you upload</strong> — tickets, reservations and photos. These often contain
          personal details; only you and the people you share a trip with can open them.
        </li>
        <li>
          <strong>Notification settings</strong> — if you turn on reminders, an anonymous identifier
          for that browser so a push can reach it.
        </li>
        <li>
          <strong>Usage analytics</strong> — see below.
        </li>
      </ul>

      <H>Analytics</H>
      <p>
        We use PostHog to see which screens are used and whether things are breaking. It records
        events like &ldquo;a place was added&rdquo; and which screen was opened, tied to your
        account id.
      </p>
      <p>
        <strong>It does not record your trip content.</strong> Automatic click-capture and session
        recording are both switched off deliberately, because they would otherwise send the text of
        whatever you tapped — a hotel&rsquo;s reservation details, or your shopping list.
      </p>

      <H>Who else processes it</H>
      <p>These companies handle data on our behalf so the app can run:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Supabase</strong> — accounts, database and file storage. Data is held on servers
          in Australia.
        </li>
        <li>
          <strong>Vercel</strong> — hosting and delivery.
        </li>
        <li>
          <strong>PostHog</strong> — analytics, as described above.
        </li>
        <li>
          <strong>Google</strong> — only if you choose to sign in with Google.
        </li>
        <li>
          <strong>Apple, Google or Mozilla</strong> — only if you turn on notifications; their push
          services deliver the message.
        </li>
      </ul>
      <p>
        Some screens look things up for you — photo search, map lookups, currency rates and
        translation. Those requests carry what you typed (a place name, for example), not who you
        are.
      </p>
      <p>We do not sell your data, and we do not use it for advertising.</p>

      <H>How long it is kept</H>
      <p>
        Trip content is kept until you delete it or delete your account. Deleting a trip removes its
        places, notes and files. Analytics events are kept by PostHog under their own retention
        settings.
      </p>

      <H>Your choices</H>
      <p>
        You can see and change almost everything from inside the app, and delete any trip you own.
        Depending on where you live you may also have the right to a copy of your data, to correct
        it, or to have it erased.
      </p>
      <p>
        <strong>There is no &ldquo;delete my account&rdquo; button yet.</strong> Email{' '}
        <a className="font-semibold text-brand" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>{' '}
        from your account&rsquo;s address and we will delete the account and its trips.
      </p>

      <H>Security, honestly</H>
      <p>
        Traffic is encrypted, files are served through short-lived signed links, and content is
        reachable only by the account it belongs to and the people that account has invited. But
        this is a small personal project, not an audited service. Please do not store anything here
        that would be seriously harmful if it leaked.
      </p>

      <H>Children</H>
      <p>
        The app is not intended for children under 13, and we do not knowingly collect their data.
      </p>

      <H>Changes</H>
      <p>
        If this page changes in a way that matters, you will be asked to read and accept it again
        the next time you open the app.
      </p>
    </Page>
  )
}
