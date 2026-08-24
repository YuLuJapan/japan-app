// The reminders badge on the tab bar.
//
// lib/push is not stubbed: `hasUnseenReminder` counts what the service worker
// says is in the notification tray and `clearReminderBadge` closes it, so the
// tray is what these cases arrange (src/tests/browser.ts) and the real
// functions do the reading.
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Layout } from '../components/Layout'
import { withPushCapableBrowser } from './browser'

// Layout's sign-out button clears the query cache, so it needs the provider it
// always has in the app. Rendered inside a real Route so useTripId() resolves.
const renderLayoutAt = (subpath: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/trips/trip-1${subpath}`]}>
        <Routes>
          <Route
            path="/trips/:tripId/*"
            element={
              <Layout>
                <div>page content</div>
              </Layout>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )

describe('Layout reminders badge', () => {
  it('shows a dot on the Reminders tab when a push has not been seen yet', async () => {
    const browser = withPushCapableBrowser({ pending: 1 })

    renderLayoutAt('')

    expect(await screen.findByLabelText('Unread reminder')).toBeInTheDocument()
    // Showing the dot must not also dismiss the notification behind it.
    expect(browser.tray[0].closed).toBe(false)
  })

  it('does not show a dot when nothing unseen is pending', async () => {
    withPushCapableBrowser()

    renderLayoutAt('')

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument())
    expect(screen.queryByLabelText('Unread reminder')).not.toBeInTheDocument()
  })

  it('clears the badge as soon as the Reminders tab is open', async () => {
    const browser = withPushCapableBrowser({ pending: 1 })

    renderLayoutAt('/reminders')

    // Opening the tab is the acknowledgement: the tray notification is closed.
    await waitFor(() => expect(browser.tray[0].closed).toBe(true))
    expect(screen.queryByLabelText('Unread reminder')).not.toBeInTheDocument()
  })

  it('lights up live when the service worker reports a push while another tab is open', async () => {
    const browser = withPushCapableBrowser()

    renderLayoutAt('')
    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument())
    expect(screen.queryByLabelText('Unread reminder')).not.toBeInTheDocument()

    act(() => browser.deliver({ type: 'reminder-badge' }))

    expect(await screen.findByLabelText('Unread reminder')).toBeInTheDocument()
  })
})
