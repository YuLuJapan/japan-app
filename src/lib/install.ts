// "Add to Home Screen" — the half of installing that the browser won't do on
// its own.
//
// Two worlds, and no single API across them:
//  - Chromium (Android, desktop) fires `beforeinstallprompt`. Calling
//    preventDefault() on it suppresses the browser's own mini-infobar and
//    keeps the event, which can then be replayed from a button of ours — once,
//    and only from a real user gesture.
//  - Safari (iOS, macOS) never fires it and exposes nothing at all. The only
//    way in is the Share menu, so the most we can do is say where it is. On
//    iOS that matters twice over: web push only works from the installed app
//    (see lib/push.ts), so someone who wants reminders *has* to do this.
//
// The event arrives once, early, and is gone if nobody keeps it — hence the
// listener at module load rather than in a component that may not have
// mounted yet. main.tsx imports this module for that reason alone.
import { useSyncExternalStore } from 'react'
import { isIos } from './push'

/** The Chromium-only event. Not in lib.dom, so it's spelled out here. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallPlatform = 'ios' | 'android' | 'desktop'
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

let deferred: BeforeInstallPromptEvent | null = null
const subscribers = new Set<() => void>()
const announce = () => subscribers.forEach((notify) => notify())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    announce()
  })
  // Installed some other way — the browser's own menu, or another tab. Stop
  // offering something that has already happened.
  window.addEventListener('appinstalled', () => {
    deferred = null
    rememberInstalled()
    announce()
  })
}

/** Which set of instructions to show. Only ever picks *words*, never gates a
 *  capability — that is what the saved prompt event is for. */
export function installPlatform(): InstallPlatform {
  if (isIos()) return 'ios'
  return /Android/i.test(navigator.userAgent) ? 'android' : 'desktop'
}

// How long "not now" lasts. Long enough not to nag, short enough that someone
// who dismissed it on the way out the door is offered it again before the trip.
const SNOOZE_DAYS = 14
const HINT_KEY = 'onward:install-hint'

// Private-mode Safari throws on localStorage rather than returning null, and a
// hint that can't remember being dismissed is a far smaller problem than a
// screen that won't render.
function readHint(): string | null {
  try {
    return window.localStorage.getItem(HINT_KEY)
  } catch {
    return null
  }
}

function writeHint(value: string) {
  try {
    window.localStorage.setItem(HINT_KEY, value)
  } catch {
    /* nothing to do — the hint just comes back next visit */
  }
}

/** Dismissed recently, or already installed: either way, don't ask again. */
export function installHintHidden(now: number = Date.now()): boolean {
  const stored = readHint()
  if (!stored) return false
  if (stored === 'installed') return true
  const until = Number(stored)
  return Number.isFinite(until) && now < until
}

export function snoozeInstallHint(now: number = Date.now()) {
  writeHint(String(now + SNOOZE_DAYS * 24 * 60 * 60 * 1000))
}

export function rememberInstalled() {
  writeHint('installed')
}

const subscribe = (notify: () => void) => {
  subscribers.add(notify)
  return () => {
    subscribers.delete(notify)
  }
}

/** True when the browser has handed us a prompt we can replay from a button. */
export function useCanPromptInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false
  )
}

/**
 * Show the browser's own install prompt.
 *
 * 'unavailable' is the ordinary answer on iOS and on any browser that hasn't
 * offered one yet — the caller falls back to the instructions rather than
 * treating it as an error.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred
  if (!event) return 'unavailable'
  // A saved prompt is single-use: whatever the answer, it can't be replayed,
  // so it goes before the await rather than after.
  deferred = null
  announce()
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') rememberInstalled()
    return outcome
  } catch {
    return 'unavailable'
  }
}
