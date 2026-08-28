// The acceptance screen. It sits after sign-in rather than as a tick-box on
// the sign-up form, because Google and the magic link both leave the page and
// come back — a checkbox there would cover one way in out of three.
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TermsGate } from '../components/TermsGate'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

const meWith = (accepted: boolean) => ({
  user: { id: 'u1', email: 'a@b.c', display_name: null },
  terms: { accepted, version: '2026-08-24' },
})

const renderGate = () =>
  renderAt('/trips', [{ path: '/trips', element: <TermsGate>the app</TermsGate> }])

describe('TermsGate', () => {
  it('lets an account that has accepted straight through', async () => {
    mocks.get.mockResolvedValue(meWith(true))
    renderGate()
    expect(await screen.findByText('the app')).toBeInTheDocument()
  })

  it('blocks an account that has not, and links both documents', async () => {
    mocks.get.mockResolvedValue(meWith(false))
    renderGate()
    expect(await screen.findByRole('link', { name: /terms of use/i })).toHaveAttribute(
      'href',
      '/terms'
    )
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/privacy'
    )
    expect(screen.queryByText('the app')).not.toBeInTheDocument()
  })

  it('sends no version — the server stamps its own', async () => {
    mocks.get.mockResolvedValue(meWith(false))
    mocks.post.mockResolvedValue({ terms: { accepted: true } })
    const user = userEvent.setup()
    renderGate()

    await user.click(await screen.findByRole('button', { name: /i agree/i }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/me/terms', {}))
  })

  it('says so when accepting fails, rather than looking stuck', async () => {
    mocks.get.mockResolvedValue(meWith(false))
    mocks.post.mockRejectedValue(new Error('offline'))
    const user = userEvent.setup()
    renderGate()

    await user.click(await screen.findByRole('button', { name: /i agree/i }))
    expect(await screen.findByText(/didn’t save/i)).toBeInTheDocument()
  })

  it('does not demand agreement when /me itself is broken', async () => {
    // The app has bigger problems, and the screens below explain them better.
    mocks.get.mockRejectedValue(new Error('offline'))
    renderGate()
    expect(await screen.findByText('the app')).toBeInTheDocument()
  })
})
