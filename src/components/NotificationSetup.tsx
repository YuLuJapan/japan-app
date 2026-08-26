// The "turn notifications on for this phone" card. Each device subscribes
// separately, against the account signed in on it, and receives the reminders
// of every trip that account is on.
//
// The awkward cases it has to explain:
//  - iOS only allows web push from the Home Screen app, never a Safari tab
//  - permission, once denied, can only be undone in the OS settings
//  - the server may have no VAPID keys yet (see README → Reminders)
import { useEffect, useState } from 'react'
import { usePushKey } from '../api/hooks'
import { InstallHelpSheet } from './InstallPrompt'
import { capture } from '../lib/posthog'
import { installPlatform } from '../lib/install'
import {
  syncPushSubscription,
  useRegisterPush,
  useSendTestPush,
  useUnregisterPush,
} from '../api/mutations'
import {
  PushError,
  currentSubscription,
  deviceLabel,
  disablePush,
  enablePush,
  notificationPermission,
  pushSupport,
  subscriptionPayload,
} from '../lib/push'

export function NotificationSetup() {
  const pushKey = usePushKey()
  const register = useRegisterPush()
  const unregister = useUnregisterPush()
  const test = useSendTestPush()

  const [support] = useState(pushSupport)
  const [enabled, setEnabled] = useState<boolean | null>(null) // null = still checking
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    let active = true
    currentSubscription()
      .then((subscription) => {
        const on = Boolean(subscription) && notificationPermission() === 'granted'
        if (active) setEnabled(on)
        // Tell the server this device is *ours* — see syncPushSubscription.
        // Deliberately not awaited and deliberately silent: it corrects
        // bookkeeping, and a failure is not something to put on this card.
        if (on && subscription) {
          syncPushSubscription(subscriptionPayload(subscription, deviceLabel())).catch(
            () => undefined
          )
        }
      })
      .catch(() => active && setEnabled(false))
    return () => {
      active = false
    }
  }, [])

  const publicKey = pushKey.data?.public_key ?? null

  const turnOn = async () => {
    if (!publicKey) return
    setBusy(true)
    setMessage(null)
    try {
      const payload = await enablePush(publicKey, deviceLabel())
      await register.mutateAsync(payload)
      // iOS only reaches this line from the installed app, so the platform is
      // what tells "nobody wants notifications" apart from "nobody could".
      capture('notifications_enabled', { platform: installPlatform() })
      setEnabled(true)
      setMessage('Notifications are on for this phone.')
    } catch (err) {
      setMessage(err instanceof PushError ? err.message : 'Could not turn notifications on.')
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const endpoint = await disablePush()
      // 404 just means the server row was already gone — nothing to recover from
      if (endpoint) await unregister.mutateAsync(endpoint).catch(() => undefined)
      capture('notifications_disabled', { platform: installPlatform() })
      setEnabled(false)
      setMessage('Notifications are off on this phone.')
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async () => {
    setMessage(null)
    const result = await test.mutateAsync().catch(() => null)
    if (!result) setMessage('Could not send the test notification.')
    else if (result.sent === 0)
      setMessage('No device is subscribed yet — turn notifications on first.')
    else {
      capture('test_notification_sent', { devices: result.sent })
      setMessage(`Test sent to ${result.sent} device${result.sent === 1 ? '' : 's'}.`)
    }
  }

  if (support === 'needs-install') {
    // Telling someone to install the app without telling them how is the whole
    // reason this card used to dead-end — the Share menu is not discoverable.
    return (
      <>
        <HintRow icon="📲">
          <strong>Add the app to your Home Screen first</strong> — on iPhone, notifications only
          work from the installed app.{' '}
          <button
            type="button"
            className="font-semibold text-brand underline underline-offset-2"
            onClick={() => setHelpOpen(true)}
          >
            Show me how
          </button>
        </HintRow>
        <InstallHelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
      </>
    )
  }

  if (support === 'unsupported') {
    return (
      <HintRow icon="🔕">
        This browser can&apos;t receive push notifications — reminders are still saved.
      </HintRow>
    )
  }

  if (pushKey.isPending) return null

  if (!publicKey) {
    return (
      <HintRow icon="🔔">
        <strong>Notifications aren&apos;t set up on the server yet.</strong> Reminders are saved
        regardless (see README → Reminders &amp; notifications).
      </HintRow>
    )
  }

  return (
    <div>
      <div
        className={`flex items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 ${
          enabled ? 'bg-brand/10' : 'bg-canvas'
        }`}
      >
        <p className="min-w-0 truncate text-xs font-semibold text-ink">
          {enabled ? 'Notifications on' : 'Notifications off'}
          <span className="font-normal text-muted"> · this device</span>
        </p>
        <button
          type="button"
          className={`chip shrink-0 font-bold ${enabled ? 'bg-white text-muted' : 'bg-ink text-white'}`}
          onClick={enabled ? turnOff : turnOn}
          disabled={busy || enabled === null}
        >
          {busy ? '…' : enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      {enabled && (
        <button
          type="button"
          className="mt-1.5 text-xs font-semibold text-brand"
          onClick={sendTest}
          disabled={test.isPending}
        >
          {test.isPending ? 'Sending…' : 'Send a test notification'}
        </button>
      )}
      {message && <p className="mt-1.5 text-xs text-muted">{message}</p>}
    </div>
  )
}

/** A slim one-line banner for the setup/unsupported states — these are rare
 *  edge cases, so they shouldn't cost the same vertical space as the toggle. */
function HintRow({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-canvas px-3.5 py-2.5">
      <span className="text-sm leading-5" aria-hidden>
        {icon}
      </span>
      <p className="text-xs leading-5 text-muted">{children}</p>
    </div>
  )
}
