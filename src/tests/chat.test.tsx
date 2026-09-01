// The chat screen.
//
// The two behaviours worth protecting here are the ones that are easy to write
// backwards and look fine in a demo: text is **appended** as it streams, not
// replaced; and offline shows the transcript with an explanation rather than a
// spinner. A spinner on a train is a lie that lasts for hours.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import TripChat from '../pages/TripChat'
import type { ChatView } from '../api/types'
import { renderAt } from './helpers'

const view = (over: Partial<ChatView> = {}): ChatView => ({
  thread: { id: 'th_1', turn_running: false },
  messages: [],
  budget: { spent_cents: 0, cap_cents: 1000, pct: 0, blocked: false, resumes_on: null },
  ...over,
})

/**
 * An SSE body, exactly as the route writes it.
 *
 * Each event is enqueued as its own chunk, which is closer to the truth than
 * one big string would be and is what makes the append-not-replace assertion
 * meaningful. `Blob.stream()` is not implemented in jsdom, so the stream is
 * built by hand.
 */
function sse(events: unknown[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

/**
 * The API, statefully.
 *
 * After a turn the screen re-reads the conversation and drops its locally
 * streamed copy, because the server now holds both messages — so a mock that
 * kept returning the *same* empty conversation would make a correct screen look
 * broken. `after` is what the GET returns once a POST has happened.
 */
function mockApi(chat: ChatView, turn?: Response, after?: ChatView) {
  let asked = false
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      asked = true
      return turn ?? sse([{ type: 'done', complete: true }])
    }
    if (url.includes('/chat')) return json(asked ? (after ?? chat) : chat)
    // The screen labels the question it is still waiting on with the asker's own
    // name, which comes from here.
    if (url.includes('/me')) {
      return json({
        user: { id: 'u_owner', email: 'yuval@example.com', display_name: 'Yuval' },
        terms: { accepted: true, version: '1' },
      })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
}

/** Adds a message to a view, for the "after the turn" state. */
const withMessage = (base: ChatView, role: 'user' | 'assistant', content: string): ChatView => ({
  ...base,
  messages: [
    ...base.messages,
    {
      id: `m-${base.messages.length}`,
      role,
      content,
      author: null,
      created_at: '2026-08-30T09:00:00Z',
    },
  ],
})

const show = () =>
  renderAt('/trips/trip-1/chat', [{ path: '/trips/:tripId/chat', element: <TripChat /> }])

beforeEach(() => {
  vi.stubGlobal('navigator', { ...navigator, onLine: true })
  // jsdom has no layout, so this is never implemented.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  // Explicit, and before the globals go: a turn still in flight would otherwise
  // keep re-rendering an unmounted screen into the next test's DOM.
  cleanup()
  // React Query's onlineManager latches what the last `offline` event told it,
  // and restoring `navigator` does not reset it — so without this an offline
  // test leaves every later query *paused*, fetching nothing and reporting no
  // error, which looks exactly like a component that decided not to load.
  //
  // Set directly rather than by dispatching `online`: the manager drops its
  // window listener once nothing is subscribed, so after `cleanup()` the event
  // reaches nobody.
  onlineManager.setOnline(true)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('an empty conversation', () => {
  it('offers openers rather than a blank box', async () => {
    mockApi(view())
    show()
    expect(await screen.findByText('Try asking:')).toBeInTheDocument()
    expect(screen.getByText('What time is our flight?')).toBeInTheDocument()
  })

  it('puts a suggestion in the box when tapped', async () => {
    mockApi(view())
    show()
    await userEvent.click(await screen.findByText('What time is our flight?'))
    expect(screen.getByLabelText('Ask about this trip')).toHaveValue('What time is our flight?')
  })
})

describe('an existing conversation', () => {
  it('shows both sides, and who asked', async () => {
    mockApi(
      view({
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'What is the plan Thursday?',
            author: { user_id: 'u1', display_name: 'Yuval' },
            created_at: '2026-08-30T09:00:00Z',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Thursday is your Hakone day.',
            author: null,
            created_at: '2026-08-30T09:00:05Z',
          },
        ],
      })
    )
    show()
    expect(await screen.findByText('What is the plan Thursday?')).toBeInTheDocument()
    expect(screen.getByText('Thursday is your Hakone day.')).toBeInTheDocument()
    // Two people share this thread, so a question without a name is ambiguous.
    expect(screen.getByText('Yuval')).toBeInTheDocument()
  })

  it('says "Someone" when the author’s account is gone', async () => {
    mockApi(
      view({
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Old question',
            author: null,
            created_at: '2026-08-30T09:00:00Z',
          },
        ],
      })
    )
    show()
    // Honest rather than inventing a name for an account the app no longer has.
    expect(await screen.findByText('Someone')).toBeInTheDocument()
  })
})

describe('asking a question', () => {
  it('appends the answer as it streams', async () => {
    mockApi(
      view(),
      sse([
        { type: 'text', text: 'Thursday is ' },
        { type: 'text', text: 'your Hakone day.' },
        { type: 'usage', usage: { input: 1, output: 1, cache_write: 0, cache_read: 100 } },
        { type: 'done', complete: true },
      ]),
      withMessage(view(), 'assistant', 'Thursday is your Hakone day.')
    )
    show()

    await userEvent.type(await screen.findByLabelText('Ask about this trip'), 'What is the plan?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    // Both fragments, joined. A screen that replaced rather than appended would
    // show only the second half and look plausible.
    await waitFor(() => {
      expect(screen.getByText('Thursday is your Hakone day.')).toBeInTheDocument()
    })
  })

  it('says when the answer is unfinished', async () => {
    mockApi(
      view(),
      sse([
        { type: 'text', text: 'I found part of it' },
        { type: 'done', complete: false },
      ]),
      withMessage(view(), 'assistant', 'I found part of it')
    )
    show()

    await userEvent.type(await screen.findByLabelText('Ask about this trip'), 'Something long')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    // The failure a silently-truncated turn would produce: an incomplete answer
    // presented as a whole one.
    expect(await screen.findByText(/unfinished/)).toBeInTheDocument()
  })

  it('shows the searching state while the model is on the web', async () => {
    // The stream is held open after the `searching` event, because that state is
    // transient by nature: it ends the moment the first text arrives. A stream
    // that closed immediately would be asserting on a frame that has already
    // gone.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: {"type":"searching","query":"hours"}\n\n`))
        await held
        controller.enqueue(encoder.encode(`data: {"type":"done","complete":true}\n\n`))
        controller.close()
      },
    })
    mockApi(view(), new Response(stream, { status: 200 }))
    show()

    await userEvent.type(await screen.findByLabelText('Ask about this trip'), 'Is it open?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByText('Searching the web…')).toBeInTheDocument()

    // Let the turn finish before the test ends. A stream left open outlives the
    // test and goes on re-rendering into the next one's DOM.
    release()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument()
    })
  })

  it('says it is reading the trip while the model opens a file', async () => {
    // The lazy prefix's own quiet moment (006). Held open for the same reason as
    // the search above: the state ends the instant the first text arrives, so a
    // stream that closed would assert on a frame that has already gone.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          encoder.encode(`data: {"type":"reading","path":"/trip/flight.json"}\n\n`)
        )
        await held
        controller.enqueue(encoder.encode(`data: {"type":"done","complete":true}\n\n`))
        controller.close()
      },
    })
    mockApi(view(), new Response(stream, { status: 200 }))
    show()

    await userEvent.type(
      await screen.findByLabelText('Ask about this trip'),
      'What time do we fly?'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('Reading your trip…')).toBeInTheDocument()
    // The path is telemetry, not something to put in front of someone standing
    // in a station.
    expect(screen.queryByText(/trip\/flight\.json/)).not.toBeInTheDocument()

    release()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument()
    })
  })

  it('shows the question straight away, not once the answer is finished', async () => {
    // The server persists the question before it calls the model, but the
    // transcript is not re-read until the turn is over — so without a local copy
    // what you typed vanishes for the whole time you are waiting for the answer,
    // which is precisely when you want to see it.
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        await held
        controller.enqueue(encoder.encode(`data: {"type":"done","complete":true}\n\n`))
        controller.close()
      },
    })
    mockApi(
      view(),
      new Response(stream, { status: 200 }),
      withMessage(view(), 'user', 'What is the plan?')
    )
    show()

    await userEvent.type(await screen.findByLabelText('Ask about this trip'), 'What is the plan?')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    // Before a single byte of the answer has arrived, and attributed — two
    // people share this thread.
    expect(await screen.findByText('What is the plan?')).toBeInTheDocument()
    expect(screen.getByText('Yuval')).toBeInTheDocument()

    release()

    // And exactly once afterwards: the local copy is dropped as the transcript
    // that holds the real one arrives.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getAllByText('What is the plan?')).toHaveLength(1)
    })
  })

  it('keeps the question when the send is refused outright', async () => {
    mockApi(view(), json({ error: { code: 'VALIDATION', message: 'Nope' } }, 409))
    show()

    const box = await screen.findByLabelText('Ask about this trip')
    await userEvent.type(box, 'Me too')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    // Nothing reached the server, so making them retype it would be rude.
    await waitFor(() => expect(box).toHaveValue('Me too'))
    expect(await screen.findByText('Nope')).toBeInTheDocument()
  })
})

describe('the budget', () => {
  it('says nothing at all below 80%', async () => {
    mockApi(
      view({
        budget: { spent_cents: 100, cap_cents: 1000, pct: 10, blocked: false, resumes_on: null },
      })
    )
    show()
    await screen.findByLabelText('Ask about this trip')
    expect(screen.queryByText(/budget/)).not.toBeInTheDocument()
  })

  it('warns at 80% without blocking anything', async () => {
    mockApi(
      view({
        budget: { spent_cents: 850, cap_cents: 1000, pct: 85, blocked: false, resumes_on: null },
      })
    )
    show()
    expect(await screen.findByText(/85% of this month’s chat budget/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument()
  })

  it('disables the composer at the cap and says when it comes back', async () => {
    mockApi(
      view({
        budget: {
          spent_cents: 1000,
          cap_cents: 1000,
          pct: 100,
          blocked: true,
          resumes_on: '2026-10-01',
        },
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'An earlier question',
            author: null,
            created_at: '2026-08-30T09:00:00Z',
          },
        ],
      })
    )
    show()

    expect(await screen.findByText(/paused until 1 October/)).toBeInTheDocument()
    expect(screen.getByLabelText('Ask about this trip')).toBeDisabled()
    // Paused, not broken: what was already asked is still readable.
    expect(screen.getByText('An earlier question')).toBeInTheDocument()
  })
})

describe('offline', () => {
  it('shows the transcript and says chat needs a signal', async () => {
    mockApi(
      view({
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: 'Saved answer',
            author: null,
            created_at: '2026-08-30T09:00:00Z',
          },
        ],
      })
    )
    show()
    await screen.findByText('Saved answer')

    vi.stubGlobal('navigator', { ...navigator, onLine: false })
    window.dispatchEvent(new Event('offline'))

    expect(await screen.findByText(/needs a signal/)).toBeInTheDocument()
    // Still readable, and no spinner.
    expect(screen.getByText('Saved answer')).toBeInTheDocument()
  })
})

describe('when chat is not configured', () => {
  it('says so rather than reporting an error', async () => {
    fetchMock = vi.fn(async () =>
      json({ error: { code: 'NOT_FOUND', message: 'Chat not found' } }, 404)
    )
    vi.stubGlobal('fetch', fetchMock)
    show()
    // 404 here means "no key on this deployment", which is a different thing
    // from something having gone wrong.
    expect(await screen.findByText(/isn’t set up/)).toBeInTheDocument()
  })
})

/**
 * The API with a working archive.
 *
 * A separate mock rather than a flag on `mockApi`, because what matters here is
 * the *sequence*: the GET must answer differently once the archive has landed,
 * or a correct screen looks broken when it re-reads and the messages come back.
 */
function mockClearableApi(chat: ChatView) {
  let cleared = false
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/chat/archive')) {
      cleared = true
      return new Response(null, { status: 204 })
    }
    if (url.includes('/me')) {
      return json({
        user: { id: 'u_owner', email: 'yuval@example.com', display_name: 'Yuval' },
        terms: { accepted: true, version: '1' },
      })
    }
    if (url.includes('/chat')) {
      return json(cleared ? { ...chat, thread: null, messages: [] } : chat)
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    get cleared() {
      return cleared
    },
  }
}

const talked = (over: Partial<ChatView> = {}): ChatView =>
  withMessage(withMessage(view(over), 'user', 'Where do we sleep Friday?'), 'assistant', 'Hakone.')

describe('starting a new conversation', () => {
  it('offers nothing to clear on an empty screen', async () => {
    // Rendered as absent rather than disabled: a greyed-out "Start over" with
    // no conversation behind it invites a tap that can never do anything.
    mockApi(view())
    show()
    expect(await screen.findByLabelText('Ask about this trip')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
  })

  it('asks before putting a shared conversation away', async () => {
    const api = mockClearableApi(talked())
    show()

    await userEvent.click(await screen.findByRole('button', { name: 'Start over' }))
    // The surprising facts, on screen before anything happens: it is shared, it
    // cannot be re-opened here, and the month's spending is unaffected.
    expect(await screen.findByText(/put away for both of you/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.cleared).toBe(false)
    expect(screen.getByText('Hakone.')).toBeInTheDocument()
  })

  it('empties the transcript once confirmed', async () => {
    mockClearableApi(talked())
    show()

    await userEvent.click(await screen.findByRole('button', { name: 'Start over' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start a new one' }))

    await waitFor(() => {
      expect(screen.queryByText('Hakone.')).not.toBeInTheDocument()
    })
    // Back to the state a trip nobody has asked anything on is in — openers, not
    // a blank box.
    expect(await screen.findByText('What’s the plan for tomorrow?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument()
  })

  it('does not hand back the month’s budget with the messages', async () => {
    // The failure worth naming: `ai_usage` belongs to the account, not the
    // thread, so an empty conversation is not a fresh allowance. If the notice
    // vanished here, the screen would be telling somebody they had room the
    // server would refuse them.
    mockClearableApi(
      talked({
        budget: { spent_cents: 900, cap_cents: 1000, pct: 90, blocked: false, resumes_on: null },
      })
    )
    show()

    await userEvent.click(await screen.findByRole('button', { name: 'Start over' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start a new one' }))

    await waitFor(() => {
      expect(screen.queryByText('Hakone.')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/used 90% of this month’s chat budget/)).toBeInTheDocument()
  })
})
