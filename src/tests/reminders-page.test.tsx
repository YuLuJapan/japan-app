// The reminders screen. The rows are real, and so is what the server says
// about push: with no VAPID keys configured it reports `public_key: null`,
// which is the state the card has to explain rather than offer a dead toggle.
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Reminders from '../pages/Reminders'
import { withIphoneInASafariTab, withPushCapableBrowser } from './browser'
import { insert, rows } from './data'
import { renderAt } from './helpers'

interface ReminderRow {
  id: string
  title: string
  remind_at: string
  time_zone: string
  body: string | null
  url: string | null
}

const reminder = (over: Record<string, unknown> = {}) => ({
  id: 'rem-1',
  trip_id: 'trip-1',
  title: 'Book the ryokan',
  body: 'Counter seats for 2',
  url: 'https://booking.example.com',
  remind_at: '2099-09-12T00:00:00.000Z',
  time_zone: 'Asia/Tokyo',
  sent_at: null,
  ...over,
})

const render = () =>
  renderAt('/trips/trip-1/reminders', [
    { path: '/trips/:tripId/reminders', element: <Reminders /> },
  ])

describe('Reminders page', () => {
  it('lists an upcoming reminder in the zone it was set in', async () => {
    await insert('reminders', [reminder()])
    render()

    expect(await screen.findByText('Book the ryokan')).toBeInTheDocument()
    expect(screen.getByText('Counter seats for 2')).toBeInTheDocument()
    // 00:00 UTC is 09:00 in Tokyo — the stored instant, shown in its own zone
    expect(screen.getByText(/09:00/)).toBeInTheDocument()
    expect(screen.getByText(/Tokyo/)).toBeInTheDocument()
  })

  it('links out to a safe url, and refuses to render one that leaves the origin', async () => {
    // Written straight to the table, which is the only way to have one: the
    // server rejects `//evil.example` on write. A row stored before it did
    // must not become a link on render either.
    await insert('reminders', [
      reminder(),
      reminder({ id: 'rem-2', title: 'Phish me', url: '//evil.example' }),
    ])
    render()

    expect(await screen.findByText('Phish me')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: /open link/i })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://booking.example.com')
    expect(links[0]).toHaveAttribute('rel', 'noreferrer noopener')
  })

  it('says nothing is scheduled when the list is empty', async () => {
    render()
    expect(await screen.findByText('Nothing scheduled yet.')).toBeInTheDocument()
  })

  it('shows a sent reminder under Done, struck through, with no edit control', async () => {
    await insert('reminders', [
      reminder({
        remind_at: '2020-01-01T00:00:00.000Z',
        sent_at: '2020-01-01T00:00:00.000Z',
      }),
    ])
    render()

    expect(await screen.findByText('Book the ryokan')).toHaveClass('line-through')
    expect(screen.getByText(/· Sent/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit reminder' })).not.toBeInTheDocument()
  })

  async function fillForm(title: string, date: string, time: string) {
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /new reminder/i }))
    await user.type(screen.getByLabelText(/what to do/i), title)
    await user.clear(screen.getByLabelText(/date/i))
    await user.type(screen.getByLabelText(/date/i), date)
    await user.clear(screen.getByLabelText(/^time$/i))
    await user.type(screen.getByLabelText(/^time$/i), time)
    return user
  }

  /** The row the page just created, whatever id the server gave it. */
  const savedReminder = async (title: string) =>
    (await rows<ReminderRow>('reminders', 'title', title))[0]

  it('reads the typed date as Israel time by default, whatever the phone is set to', async () => {
    render()
    const user = await fillForm('Book the sushi place for 20 September', '2026-08-19', '09:00')
    await user.click(screen.getByRole('button', { name: /add reminder/i }))

    await waitFor(async () => {
      const saved = await savedReminder('Book the sushi place for 20 September')
      expect(saved).toMatchObject({
        // 09:00 Jerusalem (IDT, UTC+3) — the instant, not the wall clock.
        remind_at: '2026-08-19T06:00:00+00:00',
        time_zone: 'Asia/Jerusalem',
        body: null,
        url: null,
      })
    })
  })

  it('posts a new reminder as an absolute instant in the chosen zone', async () => {
    render()
    const user = await fillForm('Book the bus seats', '2026-09-12', '09:00')
    await user.click(screen.getByRole('button', { name: /japan/i }))
    await user.click(screen.getByRole('button', { name: /add reminder/i }))

    await waitFor(async () => {
      const saved = await savedReminder('Book the bus seats')
      expect(saved).toMatchObject({
        remind_at: '2026-09-12T00:00:00+00:00', // 09:00 Tokyo
        time_zone: 'Asia/Tokyo',
      })
    })
  })

  it('explains when the server has no push keys instead of offering a dead toggle', async () => {
    // A browser that could take push, and an API with no VAPID keys set —
    // which is how this deployment is configured, and what /push/key reports.
    withPushCapableBrowser()
    render()

    expect(
      await screen.findByText(/notifications aren't set up on the server yet/i)
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on/i })).not.toBeInTheDocument()
  })

  it('tells an iPhone user to install the app before it asks for permission', async () => {
    withIphoneInASafariTab()
    render()

    expect(await screen.findByText(/add the app to your home screen first/i)).toBeInTheDocument()
  })
})
