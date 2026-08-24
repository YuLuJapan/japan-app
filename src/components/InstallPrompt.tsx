// Encouraging the Home Screen install, and explaining how where the browser
// gives us no button to press.
//
// Three pieces, because the same instructions are wanted in three places:
//  - InstallBanner   — the nudge, on the trip home, dismissible and snoozed
//  - InstallHelpRow  — a permanent row in Essentials, for whoever dismissed it
//  - InstallHelpSheet — the steps themselves
//
// All three disappear inside the installed app: `isStandalone()` means the
// person is already reading this from the Home Screen.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  type InstallPlatform,
  installHintHidden,
  installPlatform,
  promptInstall,
  snoozeInstallHint,
  useCanPromptInstall,
} from '../lib/install'
import { capture } from '../lib/posthog'
import { isStandalone } from '../lib/push'

// Written for the browser each platform actually installs from. Vague
// instructions ("use your browser menu") are worse than none — the whole point
// is to save someone hunting through a menu they've never opened.
const GUIDES: Record<InstallPlatform, { lead: string; steps: string[]; note?: string }> = {
  ios: {
    lead: 'In Safari it takes three taps.',
    steps: [
      'Tap the Share button — the square with an arrow out of the top, at the bottom of the screen (top right on an iPad).',
      'Scroll down the list and tap “Add to Home Screen”.',
      'Tap “Add”. Onward is now on your Home Screen with your other apps.',
    ],
    note: 'On an iPhone this is also the only way to receive reminder notifications — Safari tabs can’t get them.',
  },
  android: {
    lead: 'In Chrome it takes three taps.',
    steps: [
      'Tap the ⋮ menu at the top right.',
      'Tap “Add to Home screen”, or “Install app” if that’s what it says.',
      'Confirm, and Onward gets its own icon.',
    ],
  },
  desktop: {
    lead: 'Your browser can keep it in its own window.',
    steps: [
      'Look for the install icon at the right-hand end of the address bar.',
      'Or open the browser menu and choose “Install Onward…”.',
      'From then on it opens like an app, without the tabs and toolbars.',
    ],
  },
}

/** Why it's worth doing, in the fewest words that are actually true. */
const REASONS = 'Opens full screen, works offline, and can send you reminders.'

export function InstallHelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const canPrompt = useCanPromptInstall()
  const platform = installPlatform()
  const guide = GUIDES[platform]

  if (!open) return null

  const install = async () => {
    const outcome = await promptInstall()
    if (outcome !== 'unavailable') {
      capture('install_prompt_answered', { platform, outcome, source: 'help' })
      if (outcome === 'accepted') onClose()
    }
  }

  // Portalled for the same reason as ConfirmDialog: opened from inside the
  // blurred sticky header, a fixed overlay would otherwise be clipped to it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Add Onward to your Home Screen"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold leading-snug">
          Add Onward to your Home Screen
        </h2>
        <p className="mt-1 text-sm text-muted">{guide.lead}</p>
        <ol className="mt-4 space-y-3">
          {guide.steps.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand"
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="text-sm leading-snug text-ink">{step}</span>
            </li>
          ))}
        </ol>
        {guide.note && <p className="mt-4 text-xs leading-relaxed text-muted">{guide.note}</p>}
        <div className="mt-5 flex gap-3">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>
            Got it
          </button>
          {canPrompt && (
            <button type="button" className="btn-primary flex-1" onClick={install}>
              Add it now
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * The nudge itself. Hidden for good once installed, and for a fortnight after
 * a "not now" — an install prompt that reappears on every visit is the reason
 * people learn to swat them without reading.
 */
export function InstallBanner() {
  const canPrompt = useCanPromptInstall()
  const platform = installPlatform()
  // Read once: dismissing writes to storage, and re-reading it on every render
  // would fight the state below.
  const [hidden] = useState(() => isStandalone() || installHintHidden())
  const [dismissed, setDismissed] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    if (!hidden) capture('install_hint_shown', { platform })
  }, [hidden, platform])

  if (hidden) return null

  const add = async () => {
    // No saved prompt (iOS always, Chromium sometimes) — the instructions are
    // the fallback, not an error.
    const outcome = await promptInstall()
    if (outcome === 'unavailable') {
      capture('install_help_opened', { platform, source: 'banner' })
      setHelpOpen(true)
      return
    }
    capture('install_prompt_answered', { platform, outcome, source: 'banner' })
    if (outcome === 'accepted') setDismissed(true)
  }

  const notNow = () => {
    snoozeInstallHint()
    capture('install_hint_dismissed', { platform })
    setDismissed(true)
  }

  return (
    <>
      {!dismissed && (
        <div className="flex items-start gap-3 rounded-3xl border border-line bg-white px-4.5 py-4 shadow-card">
          <span className="text-xl leading-none" aria-hidden>
            📲
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold leading-snug text-ink">Keep Onward one tap away</p>
            <p className="mt-1 text-xs leading-snug text-muted">
              Add it to your Home Screen. {REASONS}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="btn-primary px-4 text-xs" onClick={add}>
                {canPrompt ? 'Add to Home Screen' : 'Show me how'}
              </button>
              <button
                type="button"
                className="px-2 py-1 text-xs font-semibold text-muted"
                onClick={notNow}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
      <InstallHelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}

/**
 * The same help, parked where it can be found on purpose: someone who tapped
 * "Not now" in September and wants the icon in October has nowhere else to go.
 */
export function InstallHelpRow() {
  const [open, setOpen] = useState(false)
  const platform = installPlatform()
  const [installed] = useState(() => isStandalone())

  if (installed) return null

  return (
    <>
      <button
        type="button"
        onClick={() => {
          capture('install_help_opened', { platform, source: 'essentials' })
          setOpen(true)
        }}
        className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white px-4.5 py-4 text-left shadow-card"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-bold leading-snug text-ink">Add Onward to your phone</span>
          <span className="mt-1 block text-xs leading-snug text-muted">{REASONS}</span>
        </span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted"
          aria-hidden
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      <InstallHelpSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
