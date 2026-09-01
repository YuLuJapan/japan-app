// The chat *window* — the part of chat that is not the conversation.
//
// Two things are worth protecting here. It opens **over** the screen you were
// reading rather than replacing it, which is the whole reason it stopped being
// a page: the question is nearly always about what is in front of you. And its
// open state is the **URL**, which is what makes the phone's Back gesture close
// it and what lets the old `/chat` address survive as a redirect into it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AskDock } from '../components/chat/AskDock'
import { renderAt } from './helpers'

const flag = vi.hoisted(() => ({ on: true }))
vi.mock('../lib/flags', () => ({ useBooleanFlag: () => flag.on }))

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  flag.on = true
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/me')) {
        return json({
          user: { id: 'u_owner', email: 'yuval@example.com', display_name: 'Yuval' },
          terms: { accepted: true, version: '1' },
        })
      }
      if (url.includes('/chat')) {
        return json({
          thread: { id: 'th_1', turn_running: false },
          messages: [],
          budget: { spent_cents: 0, cap_cents: 1000, pct: 0, blocked: false, resumes_on: null },
        })
      }
      return json({})
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A trip screen with the dock on it, opened at `path`. */
const show = (path = '/trips/trip-1') =>
  renderAt(path, [
    {
      path: '/trips/:tripId',
      element: (
        <>
          <p>The journey</p>
          <AskDock />
        </>
      ),
    },
  ])

describe('the Ask button', () => {
  it('opens the window over the screen, which is still there behind it', async () => {
    show()
    await userEvent.click(screen.getByLabelText('Ask about this trip'))

    expect(await screen.findByRole('dialog', { name: 'Trip chat' })).toBeInTheDocument()
    // The point of a window rather than a page: what you were reading did not
    // go anywhere, so closing this puts you back with nothing to navigate.
    expect(screen.getByText('The journey')).toBeInTheDocument()
  })

  it('gets out of the way once the window is open', async () => {
    show()
    await userEvent.click(screen.getByLabelText('Ask about this trip'))
    await screen.findByRole('dialog', { name: 'Trip chat' })

    // The one element left answering to that name is the box you type in — the
    // orb would otherwise float on top of the sheet's own composer.
    expect(screen.getByLabelText('Ask about this trip').tagName).toBe('TEXTAREA')
  })

  it('closes again, leaving the screen where it was', async () => {
    show()
    await userEvent.click(screen.getByLabelText('Ask about this trip'))
    await screen.findByRole('dialog', { name: 'Trip chat' })

    await userEvent.click(screen.getByLabelText('Close chat'))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Trip chat' })).not.toBeInTheDocument()
    })
    expect(screen.getByText('The journey')).toBeInTheDocument()
  })
})

describe('the URL', () => {
  it('opens the window on its own, which is what the old /chat link redirects to', async () => {
    show('/trips/trip-1?chat=1')
    expect(await screen.findByRole('dialog', { name: 'Trip chat' })).toBeInTheDocument()
  })

  it('closes a window nothing of ours pushed', async () => {
    // Arrived by bookmark, so there is no history entry to pop — the URL is
    // rewritten in place instead, and a Back press must not bring it back.
    show('/trips/trip-1?chat=1')
    await userEvent.click(await screen.findByLabelText('Close chat'))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Trip chat' })).not.toBeInTheDocument()
    })
  })
})

describe('with chat-bot off', () => {
  it('draws no button and opens nothing, even at the chat URL', async () => {
    flag.on = false
    show('/trips/trip-1?chat=1')
    await screen.findByText('The journey')
    expect(screen.queryByLabelText('Ask about this trip')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Trip chat' })).not.toBeInTheDocument()
  })
})
