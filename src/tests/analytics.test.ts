// Analytics is optional infrastructure, and the interesting case is the one
// where it is switched off: a fresh clone, CI, a preview deploy. The generated
// integration made a missing key fatal — it threw at module load, which took
// out 15 test files and blanked `npm run dev` — so these pin down that an
// unconfigured build stays silent rather than crashing or calling into an
// uninitialised client.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('posthog-js', () => ({ default: mocks }))

/** Re-import the module with the env of this test — it reads the key at load. */
async function loadWith(key?: string, host?: string) {
  vi.resetModules()
  vi.stubEnv('VITE_POSTHOG_KEY', key ?? '')
  vi.stubEnv('VITE_POSTHOG_HOST', host ?? '')
  return import('../lib/posthog')
}

beforeEach(() => {
  mocks.capture.mockClear()
  mocks.identify.mockClear()
  mocks.reset.mockClear()
})

afterEach(() => {
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
    const { capture, identify, reset } = await loadWith(undefined)
    capture('place_created')
    identify('user-1', { email: 'a@b.c' })
    reset()
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.identify).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
  })
})

describe('analytics with a key configured', () => {
  it('passes events straight through', async () => {
    const { capture, identify, reset } = await loadWith('phc_test')
    capture('place_created', { zone: 'tokyo' })
    identify('user-1', { email: 'a@b.c' })
    reset()
    expect(mocks.capture).toHaveBeenCalledWith('place_created', { zone: 'tokyo' })
    expect(mocks.identify).toHaveBeenCalledWith('user-1', { email: 'a@b.c' })
    expect(mocks.reset).toHaveBeenCalled()
  })

  it('captures a pageview per route change, not just per page load', async () => {
    // Legacy `capture_pageview: true` means "once, on load", which in a
    // createBrowserRouter app is one $pageview per cold start and nothing for
    // the navigation after it. The dated defaults are what make it
    // 'history_change'; dropping this line silently loses all navigation.
    const { posthogOptions } = await loadWith('phc_test')
    expect(posthogOptions.defaults).toBe('2026-05-30')
  })

  it('keeps trip content out of PostHog', async () => {
    // Autocapture sends the text of whatever was clicked — here, reservation
    // details and the shopping list, where an item *is* the present. Session
    // recording is off for the same reason. Both are privacy decisions.
    const { posthogOptions } = await loadWith('phc_test')
    expect(posthogOptions.autocapture).toBe(false)
    expect(posthogOptions.disable_session_recording).toBe(true)
  })

  it('falls back to the US host when none is given', async () => {
    const { posthogOptions } = await loadWith('phc_test')
    expect(posthogOptions.api_host).toBe('https://us.i.posthog.com')
  })
})
