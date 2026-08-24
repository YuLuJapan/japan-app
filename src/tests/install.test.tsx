import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InstallBanner } from '../components/InstallPrompt'
import { installHintHidden, snoozeInstallHint } from '../lib/install'

/** The Chromium event, as the browser hands it over. */
function offerInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn().mockResolvedValue(undefined)
  window.dispatchEvent(
    Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome }),
    })
  )
  return prompt
}

const setUserAgent = (value: string) =>
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value })

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
  // Consume any prompt this test offered, so it can't leak into the next one.
  window.dispatchEvent(new Event('appinstalled'))
  window.localStorage.clear()
})

describe('InstallBanner', () => {
  it('offers the browser its own prompt when there is one to replay', async () => {
    const prompt = offerInstallPrompt('accepted')
    render(<InstallBanner />)

    const button = await screen.findByRole('button', { name: 'Add to Home Screen' })
    await userEvent.click(button)

    expect(prompt).toHaveBeenCalled()
    // Accepting takes the banner away — the icon is on the Home Screen now.
    await waitFor(() =>
      expect(screen.queryByText('Keep Onward one tap away')).not.toBeInTheDocument()
    )
  })

  it('falls back to instructions where the browser offers no prompt (iOS)', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1')
    render(<InstallBanner />)

    await userEvent.click(screen.getByRole('button', { name: 'Show me how' }))

    expect(
      screen.getByRole('dialog', { name: 'Add Onward to your Home Screen' })
    ).toBeInTheDocument()
    expect(screen.getByText(/Tap the Share button/)).toBeInTheDocument()
    // The reason an iPhone owner cares beyond the icon.
    expect(screen.getByText(/only way to receive reminder notifications/)).toBeInTheDocument()
  })

  it('names the Chrome menu on Android instead of the Share sheet', async () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0.0.0 Mobile')
    render(<InstallBanner />)

    await userEvent.click(screen.getByRole('button', { name: 'Show me how' }))

    expect(screen.getByText(/Tap the ⋮ menu at the top right/)).toBeInTheDocument()
    expect(screen.queryByText(/Tap the Share button/)).not.toBeInTheDocument()
  })

  it('stays away for the rest of the day after "Not now"', async () => {
    const { unmount } = render(<InstallBanner />)
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText('Keep Onward one tap away')).not.toBeInTheDocument()

    unmount()
    render(<InstallBanner />)
    expect(screen.queryByText('Keep Onward one tap away')).not.toBeInTheDocument()
  })

  it('says nothing at all inside the installed app', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(display-mode: standalone)',
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList)

    render(<InstallBanner />)
    expect(screen.queryByText('Keep Onward one tap away')).not.toBeInTheDocument()
  })

  it('is hidden for good once the app has been installed', () => {
    window.dispatchEvent(new Event('appinstalled'))
    render(<InstallBanner />)
    expect(screen.queryByText('Keep Onward one tap away')).not.toBeInTheDocument()
  })
})

describe('the snooze', () => {
  it('expires, rather than hiding the hint forever', () => {
    const now = Date.UTC(2026, 7, 24)
    const hours = (n: number) => now + n * 60 * 60 * 1000
    snoozeInstallHint(now)

    // Not twice in one evening…
    expect(installHintHidden(hours(6))).toBe(true)
    // …but back tomorrow, while there is still a trip to install it for.
    expect(installHintHidden(hours(25))).toBe(false)
  })

  it('survives storage being unavailable (private browsing)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => snoozeInstallHint()).not.toThrow()
    expect(installHintHidden()).toBe(false)
  })
})
