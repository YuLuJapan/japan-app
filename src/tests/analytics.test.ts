// Analytics is optional infrastructure, and the interesting case is the one
// where it is switched off: a fresh clone, CI, a preview deploy. The generated
// integration made a missing key fatal — it threw at module load, which took
// out 15 test files and blanked `npm run dev` — so these pin down that an
// unconfigured build stays silent rather than crashing or calling into an
// uninitialised client.
//
// posthog-js is not replaced here. The real SDK is loaded and, where a case
// needs to know whether it was reached, spied on — an observation of the real
// object rather than a stand-in for it. Its host points at the local fixture
// server, so a configured build has somewhere harmless to send to.
import { afterEach, describe, expect, it, inject, vi } from 'vitest'

const outsideWorld = inject('outsideWorldUrl')

/**
 * Re-import the module with the env of this test — it reads the key at load.
 *
 * posthog-js is imported first so the instance handed back is the same one
 * lib/posthog.ts just wired up.
 */
async function loadWith(key?: string, host?: string, keyVar = 'VITE_POSTHOG_PROJECT_TOKEN') {
  vi.resetModules()
  vi.stubEnv('VITE_POSTHOG_PROJECT_TOKEN', '')
  vi.stubEnv('VITE_POSTHOG_KEY', '')
  vi.stubEnv(keyVar, key ?? '')
  vi.stubEnv('VITE_POSTHOG_HOST', host ?? '')
  const posthog = (await import('posthog-js')).default
  return { ...(await import('../lib/posthog')), posthog }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('analytics with no key configured', () => {
  it('imports without throwing', async () => {
    await expect(loadWith(undefined)).resolves.toBeDefined()
  })

  it('reports itself disabled, so main.tsx skips the provider', async () => {
    const { posthogKey, analyticsEnabled } = await loadWith(undefined)
    expect(posthogKey).toBeNull()
    expect(analyticsEnabled).toBe(false)
  })

  it('never calls the client — an uninitialised posthog would warn on every event', async () => {
    const { capture, identify, reset, posthog } = await loadWith(undefined)
    const sent = vi.spyOn(posthog, 'capture')
    const named = vi.spyOn(posthog, 'identify')
    const cleared = vi.spyOn(posthog, 'reset')

    capture('place_created')
    identify('user-1', { email: 'a@b.c' })
    reset()

    expect(sent).not.toHaveBeenCalled()
    expect(named).not.toHaveBeenCalled()
    expect(cleared).not.toHaveBeenCalled()
  })
})

describe('analytics with a key configured', () => {
  it('passes events straight through', async () => {
    const { capture, identify, reset, posthog } = await loadWith('phc_test', outsideWorld)
    const sent = vi.spyOn(posthog, 'capture')
    const named = vi.spyOn(posthog, 'identify')
    const cleared = vi.spyOn(posthog, 'reset')

    capture('place_created', { zone: 'tokyo' })
    identify('user-1', { email: 'a@b.c' })
    reset()

    expect(sent).toHaveBeenCalledWith('place_created', { zone: 'tokyo' })
    expect(named).toHaveBeenCalledWith('user-1', { email: 'a@b.c' })
    expect(cleared).toHaveBeenCalled()
  })

  it('captures a pageview per route change, not just per page load', async () => {
    // Legacy `capture_pageview: true` means "once, on load", which in a
    // createBrowserRouter app is one $pageview per cold start and nothing for
    // the navigation after it. The dated defaults are what make it
    // 'history_change'; dropping this line silently loses all navigation.
    const { posthogOptions } = await loadWith('phc_test', outsideWorld)
    expect(posthogOptions.defaults).toBe('2026-05-30')
  })

  it('keeps trip content out of PostHog', async () => {
    // Autocapture sends the text of whatever was clicked — here, reservation
    // details and the shopping list, where an item *is* the present. Session
    // recording is off for the same reason. Both are privacy decisions.
    const { posthogOptions } = await loadWith('phc_test', outsideWorld)
    expect(posthogOptions.autocapture).toBe(false)
    expect(posthogOptions.disable_session_recording).toBe(true)
  })

  it('accepts either env var name — the docs use one, the wizard writes the other', async () => {
    // Getting this wrong sends nothing at all while the app looks perfectly
    // healthy, which is exactly how it went unnoticed the first time.
    const fromDocs = await loadWith('phc_docs', outsideWorld, 'VITE_POSTHOG_PROJECT_TOKEN')
    expect(fromDocs.posthogKey).toBe('phc_docs')
    const fromWizard = await loadWith('phc_wizard', outsideWorld, 'VITE_POSTHOG_KEY')
    expect(fromWizard.posthogKey).toBe('phc_wizard')
  })

  it('falls back to the US host when none is given', async () => {
    const { posthogOptions } = await loadWith('phc_test')
    expect(posthogOptions.api_host).toBe('https://us.i.posthog.com')
  })
})
