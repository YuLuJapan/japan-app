// The "turn notifications on for this phone" card. Each device subscribes
// separately, so both travelers get their own row and both get every reminder.
//
// The awkward cases it has to explain:
//  - iOS only allows web push from the Home Screen app, never a Safari tab
//  - permission, once denied, can only be undone in the OS settings
//  - the server may have no VAPID keys yet (see README → Reminders)
import { useEffect, useState } from 'react'
import { usePushKey } from '../api/hooks'
import { useRegisterPush, useSendTestPush, useUnregisterPush } from '../api/mutations'
import {
  PushError,
  currentSubscription,
  deviceLabel,
  disablePush,
  enablePush,
  notificationPermission,
  pushSupport,
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

  useEffect(() => {
    let active = true
    currentSubscription()
      .then((subscription) => {
        if (active) setEnabled(Boolean(subscription) && notificationPermission() === 'granted')
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
    else setMessage(`Test sent to ${result.sent} device${result.sent === 1 ? '' : 's'}.`)
  }

  if (support === 'needs-install') {
    return (
      <Card tone="hint">
        <p className="text-sm">
          <strong>Add the app to your Home Screen first.</strong> On iPhone, notifications only work
          from the installed app: tap Share → “Add to Home Screen”, then open it from there and come
          back to this screen.
        </p>
      </Card>
    )
  }

  if (support === 'unsupported') {
    return (
      <Card tone="hint">
        <p className="text-sm">
          This browser can&apos;t receive push notifications. Reminders are still saved — open them
          on a phone with the app installed to get notified.
        </p>
      </Card>
    )
  }

  if (pushKey.isPending) return null

  if (!publicKey) {
    return (
      <Card tone="hint">
        <p className="text-sm">
          <strong>Notifications aren&apos;t set up on the server yet.</strong> Reminders are saved,
          but nothing will be delivered until the VAPID keys are configured (see README → Reminders
          &amp; notifications).
        </p>
      </Card>
    )
  }

  return (
    <Card tone={enabled ? 'on' : 'off'}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">
            {enabled ? 'Notifications on' : 'Notifications off'}{' '}
            <span className="text-xs font-normal text-muted">· this device</span>
          </p>
          <p className="text-xs text-muted">
            {enabled
              ? 'Reminders arrive even when the app is closed.'
              : 'Turn on to get reminders on this phone.'}
          </p>
        </div>
        <button
          type="button"
          className={enabled ? 'btn-ghost' : 'btn-primary'}
          onClick={enabled ? turnOff : turnOn}
          disabled={busy || enabled === null}
        >
          {busy ? '…' : enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      {enabled && (
        <button
          type="button"
          className="mt-3 text-sm font-semibold text-brand"
          onClick={sendTest}
          disabled={test.isPending}
        >
          {test.isPending ? 'Sending…' : 'Send a test notification'}
        </button>
      )}
      {message && <p className="mt-2 text-sm text-muted">{message}</p>}
    </Card>
  )
}

function Card({ tone, children }: { tone: 'on' | 'off' | 'hint'; children: React.ReactNode }) {
  const border =
    tone === 'on' ? 'border-brand/30' : tone === 'hint' ? 'border-sun/60' : 'border-line'
  return <section className={`card border ${border} p-4`}>{children}</section>
}
