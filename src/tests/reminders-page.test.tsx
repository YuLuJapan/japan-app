import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Reminders from '../pages/Reminders'
import { renderAt } from './helpers'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: mocks,
}))

// jsdom has no serviceWorker/PushManager, so the setup card would always take
// the "unsupported browser" branch; this lets a test play the phone's part.
const push = vi.hoisted(() => ({ support: 'unsupported' as string }))

vi.mock('../lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push')>()),
  pushSupport: () => push.support,
  currentSubscription: () => Promise.resolve(null),
}))

const reminder = {
  id: 'rem-1',
  trip_id: 'trip-1',
  title: 'Book the ryokan',
  body: 'Counter seats for 2',
  url: 'https://booking.example.com',
  remind_at: '2099-09-12T00:00:00.000Z',
  time_zone: 'Asia/Tokyo',
  sent_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
}

function stubApi(reminders: unknown[]) {
  mocks.get.mockImplementation((path: string) => {
    if (path === '/trips/trip-1/reminders') return Promise.resolve({ reminders })
    if (path === '/push/key') return Promise.resolve({ public_key: null })
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
  mocks.post.mockResolvedValue({ reminder })
}

const render = () =>
  renderAt('/trips/trip-1/reminders', [
    { path: '/trips/:tripId/reminders', element: <Reminders /> },
  ])

describe('Reminders page', () => {
  it('lists an upcoming reminder in the zone it was set in', async () => {
    stubApi([reminder])
    render()

    expect(await screen.findByText('Book the ryokan')).toBeInTheDocument()
    expect(screen.getByText('Counter seats for 2')).toBeInTheDocument()
    // 00:00 UTC is 09:00 in Tokyo — the stored instant, shown in its own zone
    expect(screen.getByText(/09:00/)).toBeInTheDocument()
    expect(screen.getByText(/Tokyo/)).toBeInTheDocument()
  })

  it('links out to a safe url, and refuses to render one that leaves the origin', async () => {
    stubApi([reminder, { ...reminder, id: 'rem-2', title: 'Phish me', url: '//evil.example' }])
    render()

    // The server rejects `//evil.example` on write now; a row stored before it
    // did must not become a link on render either.
    expect(await screen.findByText('Phish me')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: /open link/i })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://booking.example.com')
    expect(links[0]).toHaveAttribute('rel', 'noreferrer noopener')
  })

  it('says nothing is scheduled when the list is empty', async () => {
    stubApi([])
    render()
    expect(await screen.findByText('Nothing scheduled yet.')).toBeInTheDocument()
  })

  it('shows a sent reminder under Done, struck through, with no edit control', async () => {
    stubApi([
      { ...reminder, remind_at: '2020-01-01T00:00:00.000Z', sent_at: '2020-01-01T00:00:00.000Z' },
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

  it('reads the typed date as Israel time by default, whatever the phone is set to', async () => {
    stubApi([])
    render()
    const user = await fillForm('Book the sushi place for 20 September', '2026-08-19', '09:00')
    await user.click(screen.getByRole('button', { name: /add reminder/i }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    expect(mocks.post).toHaveBeenCalledWith('/trips/trip-1/reminders', {
      title: 'Book the sushi place for 20 September',
      body: null,
      url: null,
      remind_at: '2026-08-19T06:00:00.000Z', // 09:00 Jerusalem (IDT, UTC+3)
      time_zone: 'Asia/Jerusalem',
    })
  })

  it('posts a new reminder as an absolute instant in the chosen zone', async () => {
    stubApi([])
    render()
    const user = await fillForm('Book the bus seats', '2026-09-12', '09:00')
    await user.click(screen.getByRole('button', { name: /japan/i }))
    await user.click(screen.getByRole('button', { name: /add reminder/i }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    expect(mocks.post).toHaveBeenCalledWith('/trips/trip-1/reminders', {
      title: 'Book the bus seats',
      body: null,
      url: null,
      remind_at: '2026-09-12T00:00:00.000Z', // 09:00 Tokyo
      time_zone: 'Asia/Tokyo',
    })
  })

  it('explains when the server has no push keys instead of offering a dead toggle', async () => {
    push.support = 'ready'
    stubApi([]) // GET /push/key resolves to { public_key: null }
    render()
    expect(
      await screen.findByText(/notifications aren't set up on the server yet/i)
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /turn on/i })).not.toBeInTheDocument()
    push.support = 'unsupported'
  })

  it('tells an iPhone user to install the app before it asks for permission', async () => {
    push.support = 'needs-install'
    stubApi([])
    render()
    expect(await screen.findByText(/add the app to your home screen first/i)).toBeInTheDocument()
    push.support = 'unsupported'
  })
})
