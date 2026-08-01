import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Layout } from '../components/Layout'

const push = vi.hoisted(() => ({
  hasUnseenReminder: vi.fn(),
  clearReminderBadge: vi.fn(),
}))

vi.mock('../lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push')>()),
  hasUnseenReminder: push.hasUnseenReminder,
  clearReminderBadge: push.clearReminderBadge,
}))

beforeEach(() => {
  push.hasUnseenReminder.mockReset()
  push.clearReminderBadge.mockReset()
})

afterEach(() => {
  // @ts-expect-error test-only cleanup of a stubbed navigator property
  delete navigator.serviceWorker
})

const renderLayoutAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Layout>
        <div>page content</div>
      </Layout>
    </MemoryRouter>
  )

describe('Layout reminders badge', () => {
  it('shows a dot on the Reminders tab when a push has not been seen yet', async () => {
    push.hasUnseenReminder.mockResolvedValue(true)
    push.clearReminderBadge.mockResolvedValue(undefined)

    renderLayoutAt('/')

    expect(await screen.findByLabelText('Unread reminder')).toBeInTheDocument()
    expect(push.clearReminderBadge).not.toHaveBeenCalled()
  })

  it('does not show a dot when nothing unseen is pending', async () => {
    push.hasUnseenReminder.mockResolvedValue(false)
    push.clearReminderBadge.mockResolvedValue(undefined)

    renderLayoutAt('/')

    await waitFor(() => expect(push.hasUnseenReminder).toHaveBeenCalled())
    expect(screen.queryByLabelText('Unread reminder')).not.toBeInTheDocument()
  })

  it('clears the badge as soon as the Reminders tab is open', async () => {
    push.hasUnseenReminder.mockResolvedValue(true)
    push.clearReminderBadge.mockResolvedValue(undefined)

    renderLayoutAt('/reminders')

    await waitFor(() => expect(push.clearReminderBadge).toHaveBeenCalledTimes(1))
    expect(screen.queryByLabelText('Unread reminder')).not.toBeInTheDocument()
    // opening straight into the tab shouldn't also ask whether something's unseen
    expect(push.hasUnseenReminder).not.toHaveBeenCalled()
  })

  it('lights up live when the service worker reports a push while another tab is open', async () => {
    push.hasUnseenReminder.mockResolvedValue(false)
    push.clearReminderBadge.mockResolvedValue(undefined)

    const listeners: Record<string, (event: MessageEvent) => void> = {}
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: (type: string, handler: (event: MessageEvent) => void) => {
          listeners[type] = handler
        },
        removeEventListener: (type: string) => {
          delete listeners[type]
        },
      },
    })

    renderLayoutAt('/')
    await waitFor(() => expect(push.hasUnseenReminder).toHaveBeenCalled())
    expect(screen.queryByLabelText('Unread reminder')).not.toBeInTheDocument()

    act(() => {
      listeners.message?.(new MessageEvent('message', { data: { type: 'reminder-badge' } }))
    })

    expect(await screen.findByLabelText('Unread reminder')).toBeInTheDocument()
  })
})
